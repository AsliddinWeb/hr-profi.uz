"""Branch — physical office / store within a company. Tenant-scoped."""
from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, Any

from sqlalchemy import JSON, Boolean, Float, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TenantMixin, TimestampMixin

if TYPE_CHECKING:
    from app.models.company import Company
    from app.models.department import Department


class Branch(Base, TenantMixin, TimestampMixin):
    __tablename__ = "branches"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    address: Mapped[str | None] = mapped_column(String(500))
    photo_url: Mapped[str | None] = mapped_column(String(500))
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    geofence_radius_m: Mapped[int] = mapped_column(Integer, default=150, nullable=False)

    manager_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
    )

    # JSON shape: {"mon": {"start": "09:00", "end": "18:00"}, ...} or null = inherits company.
    working_hours: Mapped[dict[str, Any] | None] = mapped_column(JSON)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    company: Mapped["Company"] = relationship(back_populates="branches")
    departments: Mapped[list["Department"]] = relationship(
        back_populates="branch", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Branch {self.name!r}>"
