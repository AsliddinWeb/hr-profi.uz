"""AuditLog — append-only trail of critical actions (login, logout, role changes,
permission denials, owner cross-tenant queries, etc.).

Tenant-scoped *only* when ``company_id IS NOT NULL`` (Owner actions are global).
We don't inherit TenantMixin because the column must be nullable; the listener
filter would still apply since TenantMixin sets ``__tenant__ = True`` only on
classes that inherit it. So this is a global table that *manually* tracks
``company_id`` when relevant.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class AuditLog(Base):
    __tablename__ = "audit_logs"

    company_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="SET NULL"),
        index=True,
    )
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        index=True,
    )
    actor_role: Mapped[str | None] = mapped_column(String(32))

    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    resource_type: Mapped[str | None] = mapped_column(String(64), index=True)
    resource_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True), index=True)

    ip_address: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(500))

    payload: Mapped[dict[str, Any] | None] = mapped_column(JSON)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        index=True,
    )

    def __repr__(self) -> str:
        return f"<AuditLog {self.action} actor={self.actor_id}>"
