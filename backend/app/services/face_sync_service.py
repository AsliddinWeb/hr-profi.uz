"""Face template sync queue — enqueue helpers + worker dispatcher.

Public API:
  - ``enqueue_for_employee(db, employee, action)``  — fan out to every active
    device in the employee's branch.
  - ``enqueue_for_device(db, device, action)``      — fan out to every active
    employee currently in the device's branch (used after a device is added).
  - ``process_pending(db, limit)``                  — Celery worker drains
    PENDING/RETRY rows whose ``next_retry_at`` is past.

Retry policy: exponential backoff (30s, 2m, 8m, 30m, 2h) up to 5 attempts.
After that the job is FAILED and surfaced in the admin UI for manual fix
(re-upload photo, fix device IP, etc).
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING
from uuid import UUID

import httpx
from sqlalchemy import or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.device import Device, DeviceStatus
from app.models.employee import Employee
from app.models.face_sync import (
    MAX_ATTEMPTS,
    FaceSyncAction,
    FaceSyncJob,
    FaceSyncStatus,
)
from app.services.face_adapters import for_device

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)

# 30s → 2m → 8m → 30m → 2h. ``attempts`` is the count *after* the failure.
_BACKOFF_SECONDS = [30, 120, 480, 1800, 7200]


def _next_retry_at(attempts: int) -> datetime:
    idx = min(attempts - 1, len(_BACKOFF_SECONDS) - 1)
    return datetime.now(timezone.utc) + timedelta(seconds=_BACKOFF_SECONDS[max(idx, 0)])


# ---------- Enqueue helpers ------------------------------------------------


async def _branch_devices(db: AsyncSession, branch_id: UUID | None) -> list[Device]:
    if branch_id is None:
        return []
    return (
        await db.execute(
            select(Device)
            .where(
                Device.branch_id == branch_id,
                Device.is_active.is_(True),
            )
            .execution_options(skip_tenant_filter=True)
        )
    ).scalars().all()


async def _branch_employees(db: AsyncSession, branch_id: UUID | None) -> list[Employee]:
    if branch_id is None:
        return []
    return (
        await db.execute(
            select(Employee)
            .where(
                Employee.branch_id == branch_id,
                Employee.is_active.is_(True),
            )
            .execution_options(skip_tenant_filter=True)
        )
    ).scalars().all()


async def _upsert_active_job(
    db: AsyncSession,
    *,
    company_id: UUID,
    device_id: UUID,
    employee_id: UUID,
    action: FaceSyncAction,
    photo_url: str | None,
) -> FaceSyncJob:
    """Insert a PENDING job; if one already exists for the same triple in a
    non-terminal state, just bump its retry timer back to "now" so the
    worker re-tries immediately. We model this by inserting fresh rows
    only when a SUCCESS/FAILED/CANCELLED row sits there — for PENDING/RETRY
    we update in place. The unique constraint includes ``status`` so
    SUCCESS/FAILED rows don't block a fresh PENDING insert."""
    existing = (
        await db.execute(
            select(FaceSyncJob).where(
                FaceSyncJob.device_id == device_id,
                FaceSyncJob.employee_id == employee_id,
                FaceSyncJob.action == action.value,
                FaceSyncJob.status.in_(
                    (
                        FaceSyncStatus.PENDING.value,
                        FaceSyncStatus.RETRY.value,
                        FaceSyncStatus.IN_PROGRESS.value,
                    )
                ),
            )
            .execution_options(skip_tenant_filter=True)
            .limit(1)
        )
    ).scalar_one_or_none()
    if existing is not None:
        existing.next_retry_at = datetime.now(timezone.utc)
        existing.photo_url_at_enqueue = photo_url
        return existing
    job = FaceSyncJob(
        company_id=company_id,
        device_id=device_id,
        employee_id=employee_id,
        action=action.value,
        status=FaceSyncStatus.PENDING.value,
        photo_url_at_enqueue=photo_url,
        next_retry_at=datetime.now(timezone.utc),
    )
    db.add(job)
    return job


async def enqueue_for_employee(
    db: AsyncSession,
    employee: Employee,
    action: FaceSyncAction,
    *,
    devices: list[Device] | None = None,
) -> int:
    """Fan out an action across every active device in the employee's
    branch (or an explicit ``devices`` list when re-targeting after a
    branch change)."""
    targets = devices if devices is not None else await _branch_devices(
        db, employee.branch_id
    )
    for d in targets:
        await _upsert_active_job(
            db,
            company_id=employee.company_id,
            device_id=d.id,
            employee_id=employee.id,
            action=action,
            photo_url=employee.photo_url,
        )
    return len(targets)


async def enqueue_for_device(
    db: AsyncSession, device: Device, action: FaceSyncAction
) -> int:
    """Used when a device is added — pre-load every existing active employee
    of its branch so the new hardware comes online with the full roster."""
    employees = await _branch_employees(db, device.branch_id)
    for emp in employees:
        await _upsert_active_job(
            db,
            company_id=device.company_id,
            device_id=device.id,
            employee_id=emp.id,
            action=action,
            photo_url=emp.photo_url,
        )
    return len(employees)


async def cancel_for_employee(db: AsyncSession, employee_id: UUID) -> int:
    """Cancel any outstanding non-terminal jobs for an employee. Used when
    a queued enroll is superseded (e.g. employee promptly terminated)."""
    rows = (
        await db.execute(
            select(FaceSyncJob)
            .where(
                FaceSyncJob.employee_id == employee_id,
                FaceSyncJob.status.in_(
                    (
                        FaceSyncStatus.PENDING.value,
                        FaceSyncStatus.RETRY.value,
                    )
                ),
            )
            .execution_options(skip_tenant_filter=True)
        )
    ).scalars().all()
    for r in rows:
        r.status = FaceSyncStatus.CANCELLED.value
    return len(rows)


# ---------- Worker dispatcher ----------------------------------------------


async def _fetch_photo(url: str | None) -> bytes:
    """Pull the JPEG bytes from the employee's stored photo URL.

    In dry-run mode (no real hardware to send templates to) the URL may be
    a placeholder fixture that doesn't resolve — we don't want a missing
    photo to mask a real adapter bug, so we return an empty blob and let
    each adapter's own dry-run branch synthesize a vendor template id.
    """
    from app.config import settings

    if settings.face_sync_dry_run:
        return b""
    if not url:
        raise RuntimeError("face_sync.no_photo")
    async with httpx.AsyncClient(timeout=10.0) as c:
        r = await c.get(url)
        r.raise_for_status()
        return r.content


async def _run_one(db: AsyncSession, job: FaceSyncJob) -> None:
    """Execute one job. Updates ``job`` in place (caller must commit)."""
    job.status = FaceSyncStatus.IN_PROGRESS.value
    job.last_attempt_at = datetime.now(timezone.utc)
    job.attempts = (job.attempts or 0) + 1
    await db.flush()  # publish IN_PROGRESS so ops queries see live state

    try:
        device = (
            await db.execute(
                select(Device)
                .where(Device.id == job.device_id)
                .execution_options(skip_tenant_filter=True)
            )
        ).scalar_one_or_none()
        if not device or not device.is_active:
            raise RuntimeError("face_sync.device_inactive")
        # Don't even try a known-OFFLINE device — let the next sweep retry
        # once it comes back. We still count this as an attempt so a
        # forever-offline device doesn't loop infinitely.
        if device.status == DeviceStatus.OFFLINE:
            raise RuntimeError("face_sync.device_offline")

        employee = (
            await db.execute(
                select(Employee)
                .where(Employee.id == job.employee_id)
                .execution_options(skip_tenant_filter=True)
            )
        ).scalar_one_or_none()
        if not employee:
            raise RuntimeError("face_sync.employee_missing")

        adapter = for_device(device)

        if job.action == FaceSyncAction.DELETE.value:
            await adapter.delete(device, employee, job.vendor_template_id)
        else:
            photo = await _fetch_photo(employee.photo_url)
            if job.action == FaceSyncAction.UPDATE.value:
                template_id = await adapter.update(
                    device, employee, photo, job.vendor_template_id
                )
            else:
                template_id = await adapter.enroll(device, employee, photo)
            job.vendor_template_id = template_id

        job.status = FaceSyncStatus.SUCCESS.value
        job.last_error = None
        job.next_retry_at = None
    except Exception as e:  # noqa: BLE001
        msg = str(e)[:1000]
        logger.warning(
            "face_sync job %s attempt %d failed: %s",
            job.id,
            job.attempts,
            msg,
        )
        job.last_error = msg
        if job.attempts >= MAX_ATTEMPTS:
            job.status = FaceSyncStatus.FAILED.value
            job.next_retry_at = None
        else:
            job.status = FaceSyncStatus.RETRY.value
            job.next_retry_at = _next_retry_at(job.attempts)


async def process_pending(db: AsyncSession, limit: int = 50) -> dict[str, int]:
    """Drain ready PENDING/RETRY rows. Returns ``{ok, failed, total}``."""
    now = datetime.now(timezone.utc)
    rows = (
        await db.execute(
            select(FaceSyncJob)
            .where(
                FaceSyncJob.status.in_(
                    (FaceSyncStatus.PENDING.value, FaceSyncStatus.RETRY.value)
                ),
                or_(
                    FaceSyncJob.next_retry_at.is_(None),
                    FaceSyncJob.next_retry_at <= now,
                ),
            )
            .order_by(FaceSyncJob.next_retry_at.asc().nulls_first())
            .limit(limit)
            .execution_options(skip_tenant_filter=True)
        )
    ).scalars().all()

    ok = 0
    failed = 0
    for job in rows:
        await _run_one(db, job)
        if job.status == FaceSyncStatus.SUCCESS.value:
            ok += 1
        elif job.status in (FaceSyncStatus.RETRY.value, FaceSyncStatus.FAILED.value):
            failed += 1
    if rows:
        await db.commit()
    return {"ok": ok, "failed": failed, "total": len(rows)}


__all__ = [
    "MAX_ATTEMPTS",
    "cancel_for_employee",
    "enqueue_for_device",
    "enqueue_for_employee",
    "process_pending",
]
