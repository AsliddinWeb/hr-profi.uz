"""Salary models — period rollup, daily accrual ticker, payment transactions.

Pipeline:
- Each attendance check-out enqueues ``recalculate_salary_after_attendance``.
- The task reads the day's attendance + active bonuses + deductions for the
  employee, writes/updates ``SalaryDailyAccrual``, and rolls the result into
  the open ``SalaryPeriod`` (year+month).
- The mobile dashboard reads ``/salary/me/today`` and ``/salary/me/current-month``
  off these tables; live updates arrive via WebSocket ``salary_updated``.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum
from typing import TYPE_CHECKING

from sqlalchemy import (
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TenantMixin, TimestampMixin

if TYPE_CHECKING:
    pass


class PeriodStatus(StrEnum):
    DRAFT = "DRAFT"  # accumulating, recompute can change totals
    FINALIZED = "FINALIZED"  # legacy alias for APPROVED — kept for migration
    APPROVED = "APPROVED"  # admin locked it; ready to pay
    PARTIALLY_PAID = "PARTIALLY_PAID"  # some payment recorded but pending > 0
    PAID = "PAID"  # pending == 0


class TransactionType(StrEnum):
    ADVANCE = "ADVANCE"
    FULL_PAYMENT = "FULL_PAYMENT"
    BONUS = "BONUS"


class SalaryPeriod(Base, TenantMixin, TimestampMixin):
    """One row per (employee, year, month). Aggregates the month's accruals."""

    __tablename__ = "salary_periods"
    __table_args__ = (
        UniqueConstraint(
            "employee_id", "year", "month", name="uq_salary_periods_emp_year_month"
        ),
    )

    employee_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("employees.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)

    base_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    bonuses_total: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    deductions_total: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    overtime_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    kpi_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    total_earned: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    paid_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0, nullable=False)

    status: Mapped[PeriodStatus] = mapped_column(
        String(16), default=PeriodStatus.DRAFT.value, nullable=False, index=True
    )
    finalized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Approval = admin locked the period (no more recompute changes). The
    # period is now "ready for payment". Distinct from PAID.
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    approved_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    # Stamped when the last FULL_PAYMENT lands and pending == 0.
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notes: Mapped[str | None] = mapped_column(String(500))


class SalaryDailyAccrual(Base, TenantMixin, TimestampMixin):
    """Per-employee, per-day breakdown. Recomputed on each attendance event."""

    __tablename__ = "salary_daily_accruals"
    __table_args__ = (
        UniqueConstraint(
            "employee_id", "date", name="uq_salary_daily_accruals_emp_date"
        ),
    )

    employee_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("employees.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)

    hours_worked: Mapped[Decimal] = mapped_column(Numeric(6, 2), default=0, nullable=False)
    overtime_hours: Mapped[Decimal] = mapped_column(Numeric(6, 2), default=0, nullable=False)

    base_earned: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    overtime_earned: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    bonuses_earned: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    kpi_earned: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    deductions: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    total_earned: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0, nullable=False)

    computed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )


class SalaryTransaction(Base, TenantMixin, TimestampMixin):
    """A money movement. ADVANCE deducts from the next period; FULL_PAYMENT
    closes a period; BONUS is reflected back into the period total."""

    __tablename__ = "salary_transactions"

    employee_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("employees.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    period_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("salary_periods.id", ondelete="SET NULL"),
        index=True,
    )

    type: Mapped[TransactionType] = mapped_column(String(16), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    paid_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    payment_method: Mapped[str | None] = mapped_column(String(32))
    reference: Mapped[str | None] = mapped_column(String(255))
    notes: Mapped[str | None] = mapped_column(String(500))
