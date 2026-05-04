"""Salary schemas."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.salary import PeriodStatus, TransactionType
from app.schemas.common import ORMBase


class SalaryDailyRead(ORMBase):
    id: UUID
    company_id: UUID
    employee_id: UUID
    date: date
    hours_worked: Decimal
    overtime_hours: Decimal
    base_earned: Decimal
    overtime_earned: Decimal
    bonuses_earned: Decimal
    kpi_earned: Decimal
    deductions: Decimal
    total_earned: Decimal
    computed_at: datetime


class SalaryPeriodRead(ORMBase):
    id: UUID
    company_id: UUID
    employee_id: UUID
    year: int
    month: int
    base_amount: Decimal
    bonuses_total: Decimal
    deductions_total: Decimal
    overtime_amount: Decimal
    kpi_amount: Decimal
    total_earned: Decimal
    paid_amount: Decimal
    status: PeriodStatus
    finalized_at: datetime | None
    approved_at: datetime | None
    approved_by: UUID | None
    paid_at: datetime | None
    notes: str | None
    created_at: datetime
    updated_at: datetime


class PeriodApproveRequest(BaseModel):
    notes: str | None = Field(default=None, max_length=500)


class PeriodMarkPaidRequest(BaseModel):
    payment_method: str | None = Field(default="cash", max_length=32)
    reference: str | None = Field(default=None, max_length=255)
    paid_at: datetime | None = None


class BulkActionResult(BaseModel):
    affected: int


class SalaryDashboardSummary(BaseModel):
    """Top-level financial state for the salary hub."""

    year: int
    month: int
    employees: int
    total_earned: Decimal
    total_paid: Decimal
    total_pending: Decimal
    advances_outstanding: Decimal
    bonuses_total: Decimal
    deductions_total: Decimal
    kpi_total: Decimal
    overtime_total: Decimal
    by_status: dict[str, int]
    top_unpaid: list["TopUnpaidEntry"] = Field(default_factory=list)
    ytd_paid: Decimal


class TopUnpaidEntry(BaseModel):
    employee_id: UUID
    full_name: str
    employee_code: str | None
    pending_amount: Decimal
    status: PeriodStatus


class SalaryTodaySnapshot(BaseModel):
    """What the mobile app shows: live ticker + monthly running total."""

    today: SalaryDailyRead | None
    period: SalaryPeriodRead | None
    pending_amount: Decimal  # period.total_earned - period.paid_amount


class TransactionCreate(BaseModel):
    employee_id: UUID
    period_id: UUID | None = None
    type: TransactionType
    amount: Decimal = Field(gt=0)
    paid_at: datetime
    payment_method: str | None = Field(default=None, max_length=32)
    reference: str | None = Field(default=None, max_length=255)
    notes: str | None = Field(default=None, max_length=500)


class TransactionRead(ORMBase):
    id: UUID
    company_id: UUID
    employee_id: UUID
    period_id: UUID | None
    type: TransactionType
    amount: Decimal
    paid_at: datetime
    payment_method: str | None
    reference: str | None
    notes: str | None
    created_at: datetime


class PeriodWithEmployee(BaseModel):
    """Bulk-listing row for the admin Periods tab.

    Always returns a row per active employee in the company even if no
    SalaryPeriod has been created yet — the front-end shows zeroes and
    encourages the admin to click "Recompute" rather than filtering them
    out and confusing the count of who's in the company.
    """

    employee_id: UUID
    employee_code: str
    full_name: str
    photo_url: str | None
    branch_id: UUID | None
    department_id: UUID | None
    position: str | None

    period: SalaryPeriodRead | None
    pending_amount: Decimal
    has_attendance_today: bool


class EmployeeBreakdown(BaseModel):
    """Everything the per-employee detail page renders in one round trip."""

    period: SalaryPeriodRead | None
    daily: list[SalaryDailyRead]
    bonuses: list["BonusRow"] = Field(default_factory=list)
    deductions: list["DeductionRow"] = Field(default_factory=list)
    transactions: list["TransactionRead"] = Field(default_factory=list)
    leaves: list["LeaveRow"] = Field(default_factory=list)


class BonusRow(BaseModel):
    id: UUID
    type: str
    amount: Decimal
    reason: str | None
    applied_date: date
    auto_generated: bool


class DeductionRow(BaseModel):
    id: UUID
    type: str
    amount: Decimal
    reason: str | None
    applied_date: date
    auto_generated: bool


class LeaveRow(BaseModel):
    id: UUID
    leave_type_name: str
    paid: bool
    start_date: date
    end_date: date
    days: int
    status: str
    override_amount: Decimal | None


class BulkRecomputeResult(BaseModel):
    queued_employees: int
    days: int


__all__ = [
    "BonusRow",
    "BulkRecomputeResult",
    "DeductionRow",
    "BulkActionResult",
    "EmployeeBreakdown",
    "LeaveRow",
    "PeriodApproveRequest",
    "PeriodMarkPaidRequest",
    "PeriodWithEmployee",
    "SalaryDailyRead",
    "SalaryDashboardSummary",
    "SalaryPeriodRead",
    "SalaryTodaySnapshot",
    "TopUnpaidEntry",
    "TransactionCreate",
    "TransactionRead",
]
