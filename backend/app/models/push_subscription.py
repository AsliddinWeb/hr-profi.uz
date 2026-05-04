"""Web Push subscription per browser.

Each row stores a Push API endpoint + p256dh/auth keys for one (user, device)
pair. The endpoint URL is unique — the browser hands the same endpoint to us
every time the user re-grants permission, so we upsert by endpoint.
"""
from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class WebPushSubscription(Base, TimestampMixin):
    """Browser Web Push subscription.

    Not tenant-scoped via ``TenantMixin`` — the user_id alone is enough to
    isolate (a user already belongs to one company). We keep ``company_id``
    only to make per-company invalidation cheap (e.g. when a company is
    suspended we can wipe all its subscriptions in one shot).
    """

    __tablename__ = "web_push_subscriptions"
    __table_args__ = (
        UniqueConstraint("endpoint", name="uq_web_push_endpoint"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    company_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="CASCADE"),
        index=True,
    )

    endpoint: Mapped[str] = mapped_column(String(2048), nullable=False)
    p256dh: Mapped[str] = mapped_column(String(255), nullable=False)
    auth: Mapped[str] = mapped_column(String(255), nullable=False)
    user_agent: Mapped[str | None] = mapped_column(String(500))
