"""Kiosk — tablet running the kiosk attendance UI at a branch entrance.

Distinct from ``Device`` (Hikvision / ZKTeco face hardware): a kiosk is
just a browser on a tablet running our PWA in fullscreen, doing
server-side face recognition against the employee photo database.

Auth model:
  - The kiosk authenticates with ``slug`` + ``password`` over the
    public ``kiosk.hr-profi.uz`` subdomain. Returns a JWT scoped to
    role=KIOSK with ``kiosk_id`` + ``branch_id`` + ``company_id``
    pinned.
  - Branch is fixed at registration time so a kiosk physically placed
    at one site can only ever record attendance for that site.
  - Soft-delete via ``is_active``.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TenantMixin, TimestampMixin

if TYPE_CHECKING:
    from app.models.branch import Branch


class Kiosk(Base, TenantMixin, TimestampMixin):
    __tablename__ = "kiosks"
    __table_args__ = (
        UniqueConstraint("company_id", "slug", name="uq_kiosks_company_slug"),
        UniqueConstraint("company_id", "name", name="uq_kiosks_company_name"),
    )

    branch_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("branches.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    # ``slug`` shows up in the kiosk login URL (kiosk.hr-profi.uz/<slug>)
    # — Latin letters, digits, and "-". Auto-generated from name on
    # create; admin can override.
    slug: Mapped[str] = mapped_column(String(64), nullable=False, index=True)

    # Bcrypt of the operator-set password. Reset endpoint regenerates.
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    # Optional service auth (header-based) for bot/integration use.
    api_key_hash: Mapped[str | None] = mapped_column(String(255))

    # Notes — admin-facing free text (e.g. "main entrance", "back gate").
    notes: Mapped[str | None] = mapped_column(String(500))

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    branch: Mapped["Branch"] = relationship()

    def __repr__(self) -> str:
        return f"<Kiosk slug={self.slug!r} branch={self.branch_id}>"
