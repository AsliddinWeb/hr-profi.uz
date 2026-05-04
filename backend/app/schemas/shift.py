"""Shift schemas."""
from __future__ import annotations

from datetime import date, datetime, time
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.shift import ScheduleStatus, ShiftType
from app.schemas.common import ORMBase


# ---------- Templates ----------

class ShiftTemplateCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    type: ShiftType = ShiftType.FIXED
    start_time: time | None = None
    end_time: time | None = None
    break_minutes: int = Field(default=60, ge=0, le=480)
    expected_hours: Decimal | None = Field(default=None, ge=0, le=24)
    allow_overtime: bool = True


class ShiftTemplateUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=100)
    type: ShiftType | None = None
    start_time: time | None = None
    end_time: time | None = None
    break_minutes: int | None = Field(default=None, ge=0, le=480)
    expected_hours: Decimal | None = Field(default=None, ge=0, le=24)
    allow_overtime: bool | None = None
    is_active: bool | None = None


class ShiftTemplateRead(ORMBase):
    id: UUID
    company_id: UUID
    name: str
    type: ShiftType
    start_time: time | None
    end_time: time | None
    break_minutes: int
    expected_hours: Decimal | None
    allow_overtime: bool
    is_active: bool
    created_at: datetime
    updated_at: datetime


# ---------- Schedule ----------

class ShiftScheduleEntry(BaseModel):
    employee_id: UUID
    date: date
    shift_template_id: UUID | None = None
    custom_start: time | None = None
    custom_end: time | None = None
    status: ScheduleStatus = ScheduleStatus.PLANNED


class ShiftScheduleBulkCreate(BaseModel):
    entries: list[ShiftScheduleEntry] = Field(min_length=1, max_length=5000)


class ShiftScheduleRead(ORMBase):
    id: UUID
    company_id: UUID
    employee_id: UUID
    shift_template_id: UUID | None
    date: date
    custom_start: time | None
    custom_end: time | None
    status: ScheduleStatus
    created_at: datetime
    updated_at: datetime


class ShiftScheduleBulkResult(BaseModel):
    created: int
    updated: int


class MyShiftRow(BaseModel):
    """Denormalized row for the employee mobile view: includes the template's
    name + start/end so the client doesn't need a second round-trip."""

    id: UUID
    date: date
    status: ScheduleStatus
    template_name: str | None = None
    template_type: ShiftType | None = None
    # Effective start/end: prefer custom_start / custom_end, then fall back
    # to the template's, then null. The frontend can render "—" when null.
    start_time: time | None = None
    end_time: time | None = None
    break_minutes: int | None = None
    expected_hours: Decimal | None = None


__all__ = [
    "MyShiftRow",
    "ShiftScheduleBulkCreate",
    "ShiftScheduleBulkResult",
    "ShiftScheduleEntry",
    "ShiftScheduleRead",
    "ShiftTemplateCreate",
    "ShiftTemplateRead",
    "ShiftTemplateUpdate",
]
