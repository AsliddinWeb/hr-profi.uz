"""Attendance schemas."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.attendance import AttendanceMethod, AttendanceStatus, CheckType
from app.schemas.common import ORMBase


class CheckInRequest(BaseModel):
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    accuracy_m: float | None = Field(default=None, ge=0)
    selfie_base64: str | None = Field(default=None, max_length=10_000_000)
    branch_id: UUID | None = None
    notes: str | None = Field(default=None, max_length=500)


class CheckOutRequest(CheckInRequest):
    pass


class ManualAttendance(BaseModel):
    employee_id: UUID
    branch_id: UUID | None = None
    check_type: CheckType
    timestamp: datetime
    notes: str | None = Field(default=None, max_length=500)


class AttendanceRead(ORMBase):
    id: UUID
    company_id: UUID
    employee_id: UUID
    branch_id: UUID | None
    check_type: CheckType
    method: AttendanceMethod
    timestamp: datetime
    latitude: float | None
    longitude: float | None
    accuracy_m: float | None
    selfie_url: str | None
    face_match_score: Decimal | None
    is_late: bool
    late_minutes: int
    is_early_leave: bool
    overtime_minutes: int
    status: AttendanceStatus
    notes: str | None
    created_at: datetime
    # Geofence diagnostics — populated by ``list_records`` /
    # ``get_record`` when both the branch coords and the record's GPS
    # are present. Lets the UI render "412m from branch (radius 150m)"
    # without recomputing client-side.
    branch_name: str | None = None
    branch_geofence_radius_m: float | None = None
    distance_from_branch_m: float | None = None
    within_geofence: bool | None = None


class TodayStatus(BaseModel):
    """What the mobile dashboard shows up top: latest in/out + working time.

    ``on_leave`` is set when an APPROVED leave covers today — the PWA uses it
    to surface "You're on leave" and skip the check-in button. Companion
    fields tell the user *which* leave (the visible `leave_type_name`) and
    *until when* (`leave_end_date`).
    """

    # ``first_check_in`` is the earliest CHECK_IN of the day —
    # what the PWA hero card labels "Birinchi kelish". The field
    # used to be ``last_check_in`` but the service was already
    # using the last value of the loop (not the first), so the UI
    # silently showed the wrong meaning. Renamed + semantics fixed
    # together.
    first_check_in: datetime | None
    last_check_out: datetime | None
    is_working: bool
    minutes_worked_today: int
    on_leave: bool = False
    leave_type_name: str | None = None
    leave_end_date: "date | None" = None
    # Mirrors ``Company.settings.pwa_checkin_enabled`` so the mobile
    # PWA can hide its IN/OUT buttons when the company has disabled
    # this channel — without a second roundtrip just for the toggle.
    pwa_checkin_enabled: bool = True


class AttendanceUpdate(BaseModel):
    """Admin-side editable fields. Timestamp / check_type / employee_id are
    immutable to keep the audit trail honest — re-create instead of mutate."""

    status: AttendanceStatus | None = None
    notes: str | None = Field(default=None, max_length=500)


class DailyOverviewRow(BaseModel):
    """One row per active employee for a given day."""

    employee_id: UUID
    employee_code: str
    full_name: str
    photo_url: str | None
    branch_id: UUID | None
    department_id: UUID | None
    position: str | None

    first_check_in: datetime | None
    last_check_out: datetime | None
    is_currently_in: bool
    minutes_worked: int
    late_minutes: int
    overtime_minutes: int
    # PRESENT | LATE | IN_PROGRESS | ABSENT | REST_DAY | NOT_SCHEDULED
    shift_status: str


class MonthlyOverviewRow(BaseModel):
    employee_id: UUID
    employee_code: str
    full_name: str
    photo_url: str | None
    branch_id: UUID | None

    days_worked: int
    total_minutes: int
    late_minutes: int
    overtime_minutes: int
    rest_days_planned: int
    absence_days: int


__all__ = [
    "AttendanceRead",
    "AttendanceUpdate",
    "CheckInRequest",
    "CheckOutRequest",
    "DailyOverviewRow",
    "ManualAttendance",
    "MonthlyOverviewRow",
    "TodayStatus",
]
