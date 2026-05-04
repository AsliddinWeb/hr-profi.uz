"""Leave (ta'til) — types + per-employee requests."""
from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TenantMixin, TimestampMixin

if TYPE_CHECKING:
    pass


class LeaveStatus(StrEnum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    CANCELLED = "CANCELLED"


class LeaveType(Base, TenantMixin, TimestampMixin):
    __tablename__ = "leave_types"
    __table_args__ = (
        UniqueConstraint("company_id", "name", name="uq_leave_types_company_name"),
    )

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    paid: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    max_days_per_year: Mapped[int | None] = mapped_column(Integer)
    requires_document: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class LeaveRequest(Base, TenantMixin, TimestampMixin):
    __tablename__ = "leave_requests"

    employee_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("employees.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    leave_type_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("leave_types.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    start_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    end_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    days: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str | None] = mapped_column(String(500))
    document_url: Mapped[str | None] = mapped_column(String(500))

    # Admin override for the auto-computed paid leave total. When NULL the
    # salary engine falls back to ``per_day_base × days``; when set, the
    # engine uses ``override_amount / days`` per day. UI badges this as
    # "Override" so HR knows the row was hand-tuned.
    override_amount: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))

    status: Mapped[LeaveStatus] = mapped_column(
        String(16), default=LeaveStatus.PENDING.value, nullable=False, index=True
    )
    approved_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    decision_note: Mapped[str | None] = mapped_column(String(500))


class LeaveAdjustment(Base, TenantMixin, TimestampMixin):
    """Manual carry-over / opening-balance entry for a (employee, type, year).

    Adjustments are added on top of the live request-derived balance so HR
    can record:
    - opening balances when the system rolls in mid-year (positive days
      means "already used N days before we started tracking")
    - carry-over from the previous year (negative days = bonus on top of
      the cap)
    Money side mirrors the days side — paid leave types pull
    ``amount_delta`` into the totals shown on the Balances tab.
    """

    __tablename__ = "leave_adjustments"

    employee_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("employees.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    leave_type_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("leave_types.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    year: Mapped[int] = mapped_column(Integer, nullable=False, index=True)

    days_delta: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    amount_delta: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=Decimal("0"))

    reason: Mapped[str | None] = mapped_column(String(500))
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
