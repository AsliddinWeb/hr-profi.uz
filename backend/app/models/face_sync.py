"""Face template sync queue — per-(device, employee, action) job rows.

Why a queue instead of fire-and-forget HTTP calls from the API request:

- Vendor SDKs are flaky (a device can be busy / temporarily offline).
- An employee's photo may need to land on 5+ devices; if device 3 is down
  we still want devices 1, 2, 4, 5 to succeed.
- The admin needs visibility into "what failed" without grepping logs.

Each row represents one outstanding piece of work. The worker
(``app.tasks.face_sync_tasks.process_pending``) picks PENDING/RETRY rows,
calls the vendor adapter, then transitions to SUCCESS or RETRY/FAILED.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TenantMixin, TimestampMixin


class FaceSyncAction(StrEnum):
    ENROLL = "ENROLL"   # push template to device
    UPDATE = "UPDATE"   # replace existing template (photo changed)
    DELETE = "DELETE"   # remove from device (terminated / branch-changed)


class FaceSyncStatus(StrEnum):
    PENDING = "PENDING"
    IN_PROGRESS = "IN_PROGRESS"
    SUCCESS = "SUCCESS"
    RETRY = "RETRY"
    FAILED = "FAILED"   # exceeded max attempts; needs admin attention
    CANCELLED = "CANCELLED"


MAX_ATTEMPTS = 5


class FaceSyncJob(Base, TenantMixin, TimestampMixin):
    """One outstanding template-sync action against one device.

    The unique constraint on ``(device_id, employee_id, action)`` keeps the
    queue compact: re-triggering the same action just bumps an existing
    PENDING/RETRY row's attempts/last_error rather than spawning duplicates.
    SUCCESS and FAILED rows aren't subject to the constraint because
    they're terminal states — a fresh job can be created next time.
    """

    __tablename__ = "face_sync_jobs"
    __table_args__ = (
        UniqueConstraint(
            "device_id", "employee_id", "action", "status",
            name="uq_face_sync_active",
        ),
    )

    device_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("devices.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    employee_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("employees.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    action: Mapped[FaceSyncAction] = mapped_column(
        String(16), nullable=False
    )
    status: Mapped[FaceSyncStatus] = mapped_column(
        String(16),
        default=FaceSyncStatus.PENDING.value,
        nullable=False,
        index=True,
    )

    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_error: Mapped[str | None] = mapped_column(String(1000))
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    next_retry_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), index=True
    )

    # Snapshot of the photo URL at enqueue time. If the admin re-uploads a
    # new photo while a job is RETRYing, the worker uses *the latest*
    # Employee.photo_url; this column is for diagnostics only.
    photo_url_at_enqueue: Mapped[str | None] = mapped_column(String(500))

    # Vendor-side identifier returned after a successful enroll. Saved so
    # subsequent UPDATE/DELETE actions can target the exact template the
    # device knows about (some vendors require this — Hikvision FaceLib id).
    vendor_template_id: Mapped[str | None] = mapped_column(String(128))
