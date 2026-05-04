"""Company — the tenant root.

Company is the only major table that does NOT inherit ``TenantMixin`` because it
*defines* the tenant. Owner endpoints query it directly.
"""
from __future__ import annotations

from datetime import date, datetime
from enum import StrEnum
from typing import TYPE_CHECKING, Any

from sqlalchemy import JSON, Boolean, Date, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.branch import Branch
    from app.models.user import User


class CompanyPlan(StrEnum):
    FREE = "FREE"
    PRO = "PRO"
    ENTERPRISE = "ENTERPRISE"


# Default per-company tunable settings. Stored as JSON so we don't migrate every
# time we add a knob. Keys are documented in CLAUDE.md / spec section 4.
DEFAULT_COMPANY_SETTINGS: dict[str, Any] = {
    "late_threshold_min": 5,
    "late_penalty_per_min": 0,
    "overtime_after_hours": 8,
    "geofence_radius_m": 150,
    "face_match_threshold": 0.85,
    "max_devices_per_employee": 2,
    "working_days": [1, 2, 3, 4, 5],  # ISO weekday Mon=1..Sun=7
}


class Company(Base, TimestampMixin):
    __tablename__ = "companies"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    logo_url: Mapped[str | None] = mapped_column(String(500))
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Tashkent", nullable=False)
    currency: Mapped[str] = mapped_column(String(8), default="UZS", nullable=False)
    country: Mapped[str] = mapped_column(String(2), default="UZ", nullable=False)
    language_default: Mapped[str] = mapped_column(String(2), default="uz", nullable=False)

    plan: Mapped[CompanyPlan] = mapped_column(
        String(16), default=CompanyPlan.FREE.value, nullable=False
    )
    subscription_until: Mapped[date | None] = mapped_column(Date)

    settings: Mapped[dict[str, Any]] = mapped_column(
        JSON, default=lambda: dict(DEFAULT_COMPANY_SETTINGS), nullable=False
    )

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    suspended_at: Mapped[datetime | None] = mapped_column()
    suspended_reason: Mapped[str | None] = mapped_column(String(500))

    branches: Mapped[list["Branch"]] = relationship(
        back_populates="company", cascade="all, delete-orphan"
    )
    users: Mapped[list["User"]] = relationship(back_populates="company")

    def __repr__(self) -> str:
        return f"<Company {self.slug!r}>"
