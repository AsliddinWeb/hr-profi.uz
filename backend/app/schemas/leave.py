"""Leave schemas."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from app.models.leave import LeaveStatus
from app.schemas.common import ORMBase


class LeaveTypeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    paid: bool = True
    max_days_per_year: int | None = Field(default=None, ge=0, le=365)
    requires_document: bool = False


class LeaveTypeRead(ORMBase):
    id: UUID
    company_id: UUID
    name: str
    paid: bool
    max_days_per_year: int | None
    requires_document: bool
    is_active: bool
    created_at: datetime


class LeaveRequestCreate(BaseModel):
    leave_type_id: UUID
    start_date: date
    end_date: date
    reason: str | None = Field(default=None, max_length=500)
    document_url: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def _check_dates(self) -> "LeaveRequestCreate":
        if self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")
        return self


class LeaveRequestUpdate(BaseModel):
    """Admin-only edit. Dates and employee are immutable to keep audit
    coherent — only ``override_amount`` (paid leave) and ``decision_note``
    can be changed after creation."""

    override_amount: Decimal | None = Field(default=None, ge=0)
    decision_note: str | None = Field(default=None, max_length=500)
    reason: str | None = Field(default=None, max_length=500)


class LeaveDecision(BaseModel):
    status: LeaveStatus = Field(description="APPROVED or REJECTED")
    decision_note: str | None = Field(default=None, max_length=500)


class LeaveRequestRead(ORMBase):
    id: UUID
    company_id: UUID
    employee_id: UUID
    leave_type_id: UUID
    start_date: date
    end_date: date
    days: int
    reason: str | None
    document_url: str | None
    override_amount: Decimal | None
    status: LeaveStatus
    approved_by: UUID | None
    approved_at: datetime | None
    decision_note: str | None
    created_at: datetime
    updated_at: datetime


class AdminLeaveRequestCreate(LeaveRequestCreate):
    """Admin creating a leave on behalf of an employee.

    Pre-approves the request: the admin is the source of truth, so we skip
    the PENDING → APPROVED two-step. ``decision_note`` lets HR record the
    reason (verbal request, sick note, etc.) directly.
    """

    employee_id: UUID
    auto_approve: bool = True
    decision_note: str | None = Field(default=None, max_length=500)
    override_amount: Decimal | None = Field(default=None, ge=0)


class LeaveBalanceRow(BaseModel):
    """Per-(employee, leave_type) annual balance.

    ``used_days`` = sum of approved leave-days for the year, regardless of
    status flow (CANCELLED / REJECTED ignored). ``remaining`` is null when
    the type has no annual cap. ``total_paid_amount`` is the cumulative
    payroll cost: sum of ``override_amount`` where set, plus auto
    ``per_day_base × days`` for the rest. Always 0 for unpaid types.
    """

    employee_id: UUID
    employee_code: str
    full_name: str
    photo_url: str | None
    leave_type_id: UUID
    leave_type_name: str
    paid: bool
    max_days_per_year: int | None
    used_days: int
    remaining: int | None
    total_paid_amount: Decimal


class LeaveAdjustmentCreate(BaseModel):
    employee_id: UUID
    leave_type_id: UUID
    year: int = Field(ge=2000, le=2100)
    days_delta: int = Field(default=0)
    amount_delta: Decimal = Field(default=Decimal("0"))
    reason: str | None = Field(default=None, max_length=500)


class LeaveAdjustmentRead(ORMBase):
    id: UUID
    company_id: UUID
    employee_id: UUID
    leave_type_id: UUID
    year: int
    days_delta: int
    amount_delta: Decimal
    reason: str | None
    created_by: UUID | None
    created_at: datetime
    updated_at: datetime


__all__ = [
    "AdminLeaveRequestCreate",
    "LeaveAdjustmentCreate",
    "LeaveAdjustmentRead",
    "LeaveBalanceRow",
    "LeaveDecision",
    "LeaveRequestCreate",
    "LeaveRequestRead",
    "LeaveRequestUpdate",
    "LeaveTypeCreate",
    "LeaveTypeRead",
]
