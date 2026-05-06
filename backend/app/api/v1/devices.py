"""Device CRUD (admin) + signed webhook + heartbeat (device)."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy import desc, func, select

from app.core.deps import (
    CurrentUser,
    DbDep,
    TenantId,
    require_permission,
)
from app.core.exceptions import (
    NotFoundError,
    PermissionDeniedError,
    ValidationAppError,
)
from app.core.permissions import Role
from app.models.device import Device, DeviceLog, DeviceStatus
from app.models.face_sync import FaceSyncJob, FaceSyncStatus
from app.models.notification import NotificationCategory
from app.schemas.common import MessageResponse, Page
from app.schemas.device import (
    DeviceCommand,
    DeviceCreate,
    DeviceCreateResponse,
    DeviceLogRead,
    DeviceRead,
    DeviceUpdate,
    FaceSyncJobRead,
    HeartbeatPayload,
)
from app.services import audit_service, device_service, notification_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/devices", tags=["devices"])


def _company_id(user, tenant) -> UUID:
    cid = tenant or user.company_id
    if cid is None:
        raise PermissionDeniedError()
    return cid


# ---------- Admin CRUD -------------------------------------------------------

@router.get(
    "",
    response_model=Page[DeviceRead],
    dependencies=[Depends(require_permission("device.read"))],
)
async def list_devices(
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
    branch_id: UUID | None = None,
    status_filter: DeviceStatus | None = Query(None, alias="status"),
    is_active: bool | None = None,
    q: str | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
) -> Page[DeviceRead]:
    """List devices.

    ``is_active`` defaults to *None* meaning return both active and
    deactivated rows. Pass ``true``/``false`` to narrow the list.
    """
    _company_id(user, tenant)
    stmt = select(Device).order_by(Device.name)
    count_stmt = select(func.count(Device.id))
    if branch_id is not None:
        stmt = stmt.where(Device.branch_id == branch_id)
        count_stmt = count_stmt.where(Device.branch_id == branch_id)
    if status_filter is not None:
        stmt = stmt.where(Device.status == status_filter)
        count_stmt = count_stmt.where(Device.status == status_filter)
    if is_active is not None:
        stmt = stmt.where(Device.is_active.is_(is_active))
        count_stmt = count_stmt.where(Device.is_active.is_(is_active))
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(
            func.lower(Device.name).like(like)
            | func.lower(Device.serial_number).like(like)
        )
        count_stmt = count_stmt.where(
            func.lower(Device.name).like(like)
            | func.lower(Device.serial_number).like(like)
        )

    total = (await db.execute(count_stmt)).scalar_one()
    rows = (
        await db.execute(stmt.offset((page - 1) * size).limit(size))
    ).scalars().all()
    return Page[DeviceRead](
        items=[DeviceRead.model_validate(r) for r in rows],
        total=total,
        page=page,
        size=size,
    )


@router.post(
    "",
    response_model=DeviceCreateResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("device.create"))],
)
async def create_device(
    data: DeviceCreate,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> DeviceCreateResponse:
    company_id = _company_id(user, tenant)
    api_key, api_key_hash = device_service.generate_api_key()
    device = Device(
        company_id=company_id,
        api_key_hash=api_key_hash,
        **data.model_dump(),
    )
    db.add(device)
    await db.commit()
    await db.refresh(device)
    await audit_service.record(
        db,
        action="device.create",
        actor_id=user.id,
        actor_role=user.role,
        company_id=company_id,
        resource_type="device",
        resource_id=device.id,
        payload={"serial": device.serial_number, "vendor": str(device.vendor)},
        commit=True,
    )
    # Pre-load every active employee of the device's branch into the sync
    # queue so the new hardware comes online with the full roster. The
    # worker drains the queue at its own pace; the API call returns fast.
    if device.branch_id is not None:
        try:
            from app.models.face_sync import FaceSyncAction
            from app.services import face_sync_service

            await face_sync_service.enqueue_for_device(
                db, device, FaceSyncAction.ENROLL
            )
            await db.commit()
        except Exception:  # noqa: BLE001
            logger.exception(
                "face_sync enqueue (device create) failed for device=%s", device.id
            )
    return DeviceCreateResponse(device=DeviceRead.model_validate(device), api_key=api_key)


@router.get(
    "/{device_id}",
    response_model=DeviceRead,
    dependencies=[Depends(require_permission("device.read"))],
)
async def get_device(
    device_id: UUID, user: CurrentUser, db: DbDep, tenant: TenantId
) -> DeviceRead:
    _company_id(user, tenant)
    d = (await db.execute(select(Device).where(Device.id == device_id))).scalar_one_or_none()
    if not d:
        raise NotFoundError("device.not_found")
    return DeviceRead.model_validate(d)


@router.patch(
    "/{device_id}",
    response_model=DeviceRead,
    dependencies=[Depends(require_permission("device.update"))],
)
async def update_device(
    device_id: UUID,
    data: DeviceUpdate,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> DeviceRead:
    _company_id(user, tenant)
    d = (await db.execute(select(Device).where(Device.id == device_id))).scalar_one_or_none()
    if not d:
        raise NotFoundError("device.not_found")
    for f, v in data.model_dump(exclude_unset=True).items():
        setattr(d, f, v)
    await db.commit()
    await db.refresh(d)
    return DeviceRead.model_validate(d)


@router.post(
    "/{device_id}/rotate-key",
    response_model=DeviceCreateResponse,
    dependencies=[Depends(require_permission("device.update"))],
)
async def rotate_api_key(
    device_id: UUID, user: CurrentUser, db: DbDep, tenant: TenantId
) -> DeviceCreateResponse:
    _company_id(user, tenant)
    d = (await db.execute(select(Device).where(Device.id == device_id))).scalar_one_or_none()
    if not d:
        raise NotFoundError("device.not_found")
    api_key, api_key_hash = device_service.generate_api_key()
    d.api_key_hash = api_key_hash
    await db.commit()
    await db.refresh(d)
    await audit_service.record(
        db,
        action="device.rotate_key",
        actor_id=user.id,
        actor_role=user.role,
        company_id=user.company_id,
        resource_type="device",
        resource_id=d.id,
        commit=True,
    )
    return DeviceCreateResponse(device=DeviceRead.model_validate(d), api_key=api_key)


@router.delete(
    "/{device_id}",
    response_model=MessageResponse,
    dependencies=[Depends(require_permission("device.delete"))],
)
async def delete_device(
    device_id: UUID,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
    hard: bool = Query(
        False,
        description="When true, permanently delete the row (and its logs). When false, soft-deactivate.",
    ),
) -> MessageResponse:
    _company_id(user, tenant)
    d = (
        await db.execute(select(Device).where(Device.id == device_id))
    ).scalar_one_or_none()
    if not d:
        raise NotFoundError("device.not_found")
    if hard:
        # DeviceLog has FK with ondelete=CASCADE, so deleting the device
        # cascades the logs too. Audit-log this *before* delete so we know
        # what was removed.
        await audit_service.record(
            db,
            action="device.hard_delete",
            actor_id=user.id,
            actor_role=user.role,
            company_id=user.company_id,
            resource_type="device",
            resource_id=d.id,
            details={"name": d.name, "serial": d.serial_number},
            commit=False,
        )
        await db.delete(d)
        await db.commit()
        return MessageResponse(message="deleted")
    d.is_active = False
    d.status = DeviceStatus.MAINTENANCE
    await db.commit()
    return MessageResponse(message="deactivated")


@router.post(
    "/{device_id}/reactivate",
    response_model=DeviceRead,
    dependencies=[Depends(require_permission("device.update"))],
)
async def reactivate_device(
    device_id: UUID, user: CurrentUser, db: DbDep, tenant: TenantId
) -> DeviceRead:
    """Bring a deactivated device back online — sets ``is_active = True`` and
    moves status to OFFLINE (next heartbeat will flip to ONLINE)."""
    _company_id(user, tenant)
    d = (
        await db.execute(select(Device).where(Device.id == device_id))
    ).scalar_one_or_none()
    if not d:
        raise NotFoundError("device.not_found")
    d.is_active = True
    if d.status == DeviceStatus.MAINTENANCE:
        d.status = DeviceStatus.OFFLINE
    await db.commit()
    await db.refresh(d)
    return DeviceRead.model_validate(d)


@router.get(
    "/{device_id}/logs",
    response_model=Page[DeviceLogRead],
    dependencies=[Depends(require_permission("device.read"))],
)
async def list_logs(
    device_id: UUID,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
) -> Page[DeviceLogRead]:
    _company_id(user, tenant)
    total = (
        await db.execute(
            select(func.count(DeviceLog.id)).where(DeviceLog.device_id == device_id)
        )
    ).scalar_one()
    rows = (
        await db.execute(
            select(DeviceLog)
            .where(DeviceLog.device_id == device_id)
            .order_by(desc(DeviceLog.received_at))
            .offset((page - 1) * size)
            .limit(size)
        )
    ).scalars().all()
    return Page[DeviceLogRead](
        items=[DeviceLogRead.model_validate(r) for r in rows],
        total=total,
        page=page,
        size=size,
    )


# ---------- Webhook (device → server) ----------------------------------------

@router.post("/webhook/event")
async def webhook_event(request: Request, db: DbDep) -> dict:
    """Vendor-neutral webhook entrypoint.

    Auth: either signed headers (X-WTP-Device + X-WTP-Key + X-WTP-Signature)
    or ``?key=<api_key>`` query string for legacy terminals — see
    ``authenticate_webhook``.

    Body format depends on vendor and firmware:
      - Pure JSON ``application/json`` (newer Hik firmware, ZKTeco PUSH)
      - Multipart ``multipart/form-data`` with a JSON part + jpeg image
        (older Hikvision face terminals — DS-K1T343 V3.3.x and friends)
      - XML (very old Hikvision firmware) — TODO

    We try each in turn so the same endpoint serves every device kind.

    Idempotency: when the vendor surfaces an ``event_external_id`` (Hikvision
    serialNo, Dahua EventID, etc.) and we've already processed it, we return
    the cached attendance id without creating a duplicate row.
    """
    import json as _json
    import logging

    body = await request.body()
    device = await device_service.authenticate_webhook(db, request, body)

    content_type = request.headers.get("content-type", "")
    raw: dict[str, Any] | None = None

    # 1) Pure JSON
    if "application/json" in content_type or content_type == "":
        try:
            raw = _json.loads(body or b"{}")
        except Exception:  # noqa: BLE001
            raw = None

    # 2) Multipart — Hikvision DS-K1T343 sends event JSON as one part
    #    (typically named ``event_log``) plus channel images as other parts.
    if raw is None and "multipart/form-data" in content_type:
        try:
            form = await request.form()
            for key, val in form.multi_items():
                # First text-like part that parses as JSON wins.
                if hasattr(val, "filename") and val.filename:
                    continue  # skip image attachments
                text = val if isinstance(val, str) else val.decode(  # type: ignore[union-attr]
                    "utf-8", errors="ignore"
                )
                try:
                    candidate = _json.loads(text)
                    if isinstance(candidate, dict):
                        raw = candidate
                        break
                except Exception:  # noqa: BLE001
                    continue
        except Exception:  # noqa: BLE001
            pass

    if raw is None:
        # Last-ditch: log a sample so admins can see what the device emits
        # when it doesn't fit either JSON or multipart-with-JSON.
        logging.getLogger(__name__).warning(
            "webhook unparsable body: device=%s content_type=%r body[:300]=%r",
            device.id,
            content_type,
            body[:300],
        )
        raise ValidationAppError("device.bad_json") from None

    event = device_service.parse_event(device, raw)
    await device_service.mark_seen(db, device)

    if event.event_type == "heartbeat":
        await device_service.log_event(
            db,
            device,
            "heartbeat",
            raw,
            external_event_id=event.event_external_id,
        )
        await db.commit()
        return {"ok": True}

    if event.event_type == "face_match":
        # Idempotency: cheap pre-flight check before we touch attendance.
        if event.event_external_id:
            dup = await device_service.find_duplicate_event(
                db, device, event.event_external_id
            )
            if dup is not None:
                await db.commit()
                return {
                    "ok": True,
                    "duplicate": True,
                    "logged_at": dup.received_at.isoformat(),
                }

        rec, anomalies = await device_service.process_face_match(db, device, event)
        await device_service.log_event(
            db,
            device,
            "face_match",
            raw,
            employee_id=rec.employee_id if rec else None,
            success=rec is not None,
            error=", ".join(anomalies) if anomalies and rec is None else None,
            external_event_id=event.event_external_id,
        )
        await db.commit()
        if rec is None:
            return {"ok": False, "anomalies": anomalies}
        if anomalies:
            await notification_service.notify_company_admins(
                db,
                company_id=device.company_id,
                title=f"Suspicious face match: {event.employee_code}",
                body=", ".join(anomalies),
                category=NotificationCategory.ANOMALY,
                payload={
                    "device_id": str(device.id),
                    "employee_code": event.employee_code,
                    "score": event.face_match_score,
                    "anomalies": anomalies,
                },
            )
            # Also fan out to the device's branch manager(s). Anomalies on a
            # single branch's hardware shouldn't only land in the company-
            # wide pool — the local BM is the right escalation point.
            if device.branch_id is not None:
                await notification_service.notify_branch_managers(
                    db,
                    company_id=device.company_id,
                    branch_id=device.branch_id,
                    title=f"Suspicious face match: {event.employee_code}",
                    body=", ".join(anomalies),
                    category=NotificationCategory.ANOMALY,
                    payload={
                        "device_id": str(device.id),
                        "employee_code": event.employee_code,
                        "score": event.face_match_score,
                        "anomalies": anomalies,
                    },
                )
        return {
            "ok": True,
            "attendance_id": str(rec.id),
            "check_type": str(rec.check_type),
            "status": str(rec.status),
            "anomalies": anomalies,
        }

    # Unknown event — log it but don't fail.
    await device_service.log_event(
        db,
        device,
        event.event_type,
        raw,
        external_event_id=event.event_external_id,
    )
    await db.commit()
    return {"ok": True, "ignored": event.event_type}


_TIME_DRIFT_ALERT_SECONDS = 5 * 60   # 5 minute clock skew triggers an alert
_TIME_DRIFT_LAST_ALERTED: dict[str, datetime] = {}
_TIME_DRIFT_REPEAT_HOURS = 12


@router.post("/webhook/heartbeat")
async def webhook_heartbeat(
    request: Request,
    db: DbDep,
    payload: HeartbeatPayload,
) -> dict:
    body = await request.body()
    device = await device_service.authenticate_webhook(db, request, body)
    await device_service.mark_seen(db, device)
    if payload.firmware_version:
        device.firmware_version = payload.firmware_version
    if payload.ip_address:
        device.ip_address = payload.ip_address

    # Time-drift detection: if the device's reported wall-clock disagrees
    # with the server by more than 5 minutes, flag it. Without this, a
    # device with a flat RTC battery silently produces attendance records
    # at the wrong timestamp — much harder to spot than an offline alert.
    server_now = datetime.now(timezone.utc)
    drift_seconds: float | None = None
    drift_alarmed = False
    if payload.timestamp is not None:
        delta = (server_now - payload.timestamp).total_seconds()
        drift_seconds = abs(delta)
        if drift_seconds > _TIME_DRIFT_ALERT_SECONDS:
            # De-bounce: only alert once per 12h per device so a stuck
            # clock doesn't spam the admin.
            last = _TIME_DRIFT_LAST_ALERTED.get(str(device.id))
            if (
                last is None
                or (server_now - last).total_seconds() > _TIME_DRIFT_REPEAT_HOURS * 3600
            ):
                _TIME_DRIFT_LAST_ALERTED[str(device.id)] = server_now
                drift_alarmed = True
                await notification_service.notify_company_admins(
                    db,
                    company_id=device.company_id,
                    title=f"Device clock drift: {device.name}",
                    body=(
                        f"Device clock is off by {int(drift_seconds)}s; "
                        "attendance timestamps will be inaccurate until NTP sync."
                    ),
                    category=NotificationCategory.DEVICE,
                    payload={
                        "device_id": str(device.id),
                        "drift_seconds": drift_seconds,
                        "device_time": payload.timestamp.isoformat(),
                        "server_time": server_now.isoformat(),
                    },
                )

    await device_service.log_event(
        db,
        device,
        "heartbeat",
        {
            **payload.model_dump(mode="json"),
            "drift_seconds": drift_seconds,
            "drift_alarmed": drift_alarmed,
        },
    )
    await db.commit()
    return {
        "ok": True,
        "server_time": server_now.isoformat(),
        "drift_seconds": drift_seconds,
    }


# ---------- Operational commands -------------------------------------------

@router.post(
    "/{device_id}/command",
    response_model=MessageResponse,
    dependencies=[Depends(require_permission("device.update"))],
)
async def device_command(
    device_id: UUID,
    data: DeviceCommand,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> MessageResponse:
    """Fire an out-of-band command at a device.

    REBOOT  — call the vendor reboot URL.
    RESYNC  — enqueue ENROLL for every active branch employee. Existing
              templates on the device are upserted by employee_code, so
              this safely refreshes a unit that was reset or upgraded.
    CLEAR   — enqueue DELETE for every active branch employee. Used as a
              destructive prep step before decommissioning a device.

    The audit log captures who fired the command + the optional ``note``
    so post-mortem investigation has the full picture.
    """
    _company_id(user, tenant)
    d = (
        await db.execute(select(Device).where(Device.id == device_id))
    ).scalar_one_or_none()
    if not d:
        raise NotFoundError("device.not_found")

    from app.models.face_sync import FaceSyncAction
    from app.services import face_sync_service
    from app.services.face_adapters import commands as device_commands

    if data.action == "REBOOT":
        try:
            await device_commands.reboot(d)
            ok_message = "rebooted"
        except Exception as e:  # noqa: BLE001
            raise ValidationAppError(
                "device.reboot_failed", reason=str(e)[:200]
            ) from e
    elif data.action == "RESYNC":
        n = await face_sync_service.enqueue_for_device(
            db, d, FaceSyncAction.ENROLL
        )
        await db.commit()
        ok_message = f"resync_queued:{n}"
    elif data.action == "CLEAR":
        n = await face_sync_service.enqueue_for_device(
            db, d, FaceSyncAction.DELETE
        )
        await db.commit()
        ok_message = f"clear_queued:{n}"
    else:  # pragma: no cover — guarded by the schema regex
        raise ValidationAppError("device.unknown_command")

    await audit_service.record(
        db,
        action=f"device.command.{data.action.lower()}",
        actor_id=user.id,
        actor_role=user.role,
        company_id=user.company_id,
        resource_type="device",
        resource_id=d.id,
        payload={"note": data.note} if data.note else None,
        commit=True,
    )
    return MessageResponse(message=ok_message)


# ---------- Face-template sync queue ---------------------------------------

@router.get(
    "/face-sync/jobs",
    response_model=Page[FaceSyncJobRead],
    dependencies=[Depends(require_permission("device.read"))],
)
async def list_face_sync_jobs(
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
    device_id: UUID | None = None,
    employee_id: UUID | None = None,
    status_filter: FaceSyncStatus | None = Query(None, alias="status"),
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
) -> Page[FaceSyncJobRead]:
    """Browse the face-template sync queue.

    Sorted newest-first; PENDING/RETRY/IN_PROGRESS rows surface naturally
    because they're created later or updated more recently. Admin can use
    the ``status=FAILED`` filter to find rows that need attention after
    five exhausted retries.
    """
    _company_id(user, tenant)
    stmt = select(FaceSyncJob).order_by(desc(FaceSyncJob.updated_at))
    count_stmt = select(func.count(FaceSyncJob.id))
    if device_id is not None:
        stmt = stmt.where(FaceSyncJob.device_id == device_id)
        count_stmt = count_stmt.where(FaceSyncJob.device_id == device_id)
    if employee_id is not None:
        stmt = stmt.where(FaceSyncJob.employee_id == employee_id)
        count_stmt = count_stmt.where(FaceSyncJob.employee_id == employee_id)
    if status_filter is not None:
        stmt = stmt.where(FaceSyncJob.status == status_filter.value)
        count_stmt = count_stmt.where(FaceSyncJob.status == status_filter.value)
    total = (await db.execute(count_stmt)).scalar_one()
    rows = (
        await db.execute(stmt.offset((page - 1) * size).limit(size))
    ).scalars().all()
    return Page[FaceSyncJobRead](
        items=[FaceSyncJobRead.model_validate(r) for r in rows],
        total=total,
        page=page,
        size=size,
    )


@router.post(
    "/face-sync/jobs/{job_id}/retry",
    response_model=FaceSyncJobRead,
    dependencies=[Depends(require_permission("device.update"))],
)
async def retry_face_sync_job(
    job_id: UUID, user: CurrentUser, db: DbDep, tenant: TenantId
) -> FaceSyncJobRead:
    """Reset a FAILED/RETRY/SUCCESS job back to PENDING with attempts=0.

    SUCCESS retry is allowed because admins occasionally need to re-push
    after a device was wiped or downgraded. Doesn't touch the unique
    constraint because we move the row's status without inserting a new
    one.
    """
    _company_id(user, tenant)
    job = (
        await db.execute(select(FaceSyncJob).where(FaceSyncJob.id == job_id))
    ).scalar_one_or_none()
    if not job:
        raise NotFoundError("face_sync.job_not_found")
    job.status = FaceSyncStatus.PENDING.value
    job.attempts = 0
    job.last_error = None
    job.next_retry_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(job)
    return FaceSyncJobRead.model_validate(job)


@router.post(
    "/face-sync/run",
    response_model=MessageResponse,
    dependencies=[Depends(require_permission("device.update"))],
)
async def run_face_sync_now(user: CurrentUser, db: DbDep) -> MessageResponse:
    """Manual trigger that drains the queue immediately. Useful in dev or
    when an admin doesn't want to wait the 30s for the Celery beat tick."""
    from app.services import face_sync_service

    res = await face_sync_service.process_pending(db, limit=200)
    return MessageResponse(message=f"ok:{res['ok']} failed:{res['failed']}")


# ---------- Maintenance / sweeper ------------------------------------------

@router.post(
    "/sweep-offline",
    response_model=MessageResponse,
)
async def sweep_offline(user: CurrentUser, db: DbDep) -> MessageResponse:
    """Manual trigger for the offline sweeper. Owners only — Celery beat will
    call this automatically once it lands in Phase 4.5."""
    if user.role != Role.OWNER:
        raise PermissionDeniedError()
    n = await device_service.sweep_offline_devices(db)
    return MessageResponse(message=f"marked_offline:{n}")
