"""In-app notification feed.

Stores per-user notification rows so a returning user sees their unread items
(KPI achieved, leave decision, salary paid, anomaly detected). Realtime push
goes via WS; this is the durable storage that survives reload.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import TYPE_CHECKING, Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    pass


class NotificationCategory(StrEnum):
    SYSTEM = "SYSTEM"
    ATTENDANCE = "ATTENDANCE"
    SALARY = "SALARY"
    KPI = "KPI"
    LEAVE = "LEAVE"
    DEVICE = "DEVICE"
    ANOMALY = "ANOMALY"


class Notification(Base, TimestampMixin):
    """Targeted at a single user. We don't inherit TenantMixin because the
    user already pins the tenant via their company_id; we filter manually."""

    __tablename__ = "notifications"

    company_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="CASCADE"),
        index=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    category: Mapped[NotificationCategory] = mapped_column(
        String(16), default=NotificationCategory.SYSTEM.value, nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str | None] = mapped_column(String(1000))
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSON)

    is_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class NotificationPreference(Base, TimestampMixin):
    """Per-user × per-category opt-in switches. Missing rows are treated as
    enabled — only existing rows with ``enabled = False`` mute a category."""

    __tablename__ = "notification_preferences"
    __table_args__ = (
        UniqueConstraint(
            "user_id", "category", name="uq_notification_preferences_user_category"
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    category: Mapped[NotificationCategory] = mapped_column(
        String(16), nullable=False, index=True
    )
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
