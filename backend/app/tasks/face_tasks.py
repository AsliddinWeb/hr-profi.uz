"""Celery tasks for server-side face recognition (Phase 4).

Single task today: ``face.compute_employee_embedding`` — pulls the
employee's photo, runs it through the face_recognition encoder, and
stores the resulting 128-d embedding in ``employees.face_embedding``.

Triggered from:
  * the employee CRUD endpoint when ``photo_url`` changes,
  * the backfill management script (one-shot for existing rows).

Errors are logged and swallowed: if a photo can't be processed (no
face, corrupted upload), the row keeps its previous embedding and the
admin can re-upload a better photo. Failing the task hard would loop
forever in the broker.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from uuid import UUID

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import settings
from app.core.tenant import install_tenant_listener
from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)


def _make_engine():
    from sqlalchemy import NullPool

    return create_async_engine(settings.database_url_async, poolclass=NullPool)


async def _fetch_photo_bytes(url: str) -> bytes | None:
    """Download an employee photo. We hit the MinIO public URL the same
    way the kiosk would — no fancy SDK auth — because employee photos
    are world-readable per the bucket policy and this code runs inside
    the docker network where the MinIO endpoint is reachable.
    """
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            return resp.content
    except Exception:  # noqa: BLE001 — log + swallow, see module docstring
        logger.warning("face: photo fetch failed url=%s", url, exc_info=False)
        return None


async def _compute_async(employee_id: UUID) -> dict:
    """Async core. Wrapped in ``run_until_complete`` from the sync task
    so we can use SQLAlchemy's async session inside Celery."""
    from app.models.employee import Employee
    from app.services import face_service

    engine = _make_engine()
    Session = async_sessionmaker(bind=engine, expire_on_commit=False)
    try:
        async with Session() as db:
            install_tenant_listener()
            emp = (
                await db.execute(
                    select(Employee)
                    .where(Employee.id == employee_id)
                    .execution_options(skip_tenant_filter=True)
                )
            ).scalar_one_or_none()
            if emp is None:
                return {"status": "not_found", "employee_id": str(employee_id)}
            if not emp.photo_url:
                # Clear any stale embedding so the kiosk doesn't keep
                # matching faces against a deleted photo.
                if emp.face_embedding is not None:
                    emp.face_embedding = None
                    emp.face_enrolled_at = None
                    await db.commit()
                return {"status": "no_photo", "employee_id": str(employee_id)}

            photo = await _fetch_photo_bytes(emp.photo_url)
            if photo is None:
                return {"status": "fetch_failed", "employee_id": str(employee_id)}

            arr = face_service.compute_embedding(photo)
            if arr is None:
                return {"status": "no_face", "employee_id": str(employee_id)}

            emp.face_embedding = face_service.encode_embedding(arr)
            emp.face_enrolled_at = datetime.now(timezone.utc)
            await db.commit()
            return {
                "status": "enrolled",
                "employee_id": str(employee_id),
                "enrolled_at": emp.face_enrolled_at.isoformat(),
            }
    finally:
        await engine.dispose()


@celery_app.task(name="face.compute_employee_embedding", bind=True, max_retries=2)
def compute_employee_embedding(self, employee_id: str) -> dict:
    """Compute / refresh the face embedding for one employee. Safe to
    call repeatedly — the task is idempotent (latest photo wins)."""
    try:
        return asyncio.get_event_loop().run_until_complete(
            _compute_async(UUID(employee_id))
        )
    except RuntimeError:
        # No event loop in this thread → spin a fresh one.
        return asyncio.run(_compute_async(UUID(employee_id)))
    except Exception as exc:  # noqa: BLE001
        logger.exception("face.compute_employee_embedding failed")
        # Retry on transient failures (e.g. MinIO restart) but cap at 2.
        raise self.retry(exc=exc, countdown=30) from exc


__all__ = ["compute_employee_embedding"]
