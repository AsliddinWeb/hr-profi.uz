"""RefreshToken — server-side handle for rotating refresh tokens.

We store ``jti`` (not the full token) so revocation is O(1) without comparing
JWT bodies. ``device_id`` enforces the "max 2 devices per employee" rule —
checked in ``auth_service.refresh()``.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.user import User


class RefreshToken(Base, TimestampMixin):
    __tablename__ = "refresh_tokens"
    __table_args__ = (
        UniqueConstraint("jti", name="uq_refresh_tokens_jti"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    jti: Mapped[str] = mapped_column(String(64), nullable=False, index=True)

    device_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True), index=True)
    device_name: Mapped[str | None] = mapped_column(String(200))
    device_platform: Mapped[str | None] = mapped_column(String(32))  # ios | android | web
    user_agent: Mapped[str | None] = mapped_column(String(500))
    ip_address: Mapped[str | None] = mapped_column(String(64))

    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    rotated_to: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("refresh_tokens.id", ondelete="SET NULL"),
    )

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    user: Mapped["User"] = relationship()

    def __repr__(self) -> str:
        return f"<RefreshToken jti={self.jti[:8]}… user={self.user_id}>"
