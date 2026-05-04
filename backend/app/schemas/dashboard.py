"""Dashboard summary schemas — cross-module aggregates for the home page."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel


class DashboardCounts(BaseModel):
    employees_active: int
    employees_total: int
    branches: int
    departments: int
    devices_online: int
    devices_offline: int
    devices_total: int


class DashboardAttendance(BaseModel):
    """What's happening in attendance right now."""

    present_today: int
    late_today: int
    absent_today: int
    rest_today: int
    currently_working: int
    overtime_minutes_today: int


class DashboardLeaves(BaseModel):
    pending_count: int
    approved_this_month: int
    rejected_this_month: int


class DashboardSalary(BaseModel):
    """Money state for the current month."""

    year: int
    month: int
    total_earned: Decimal
    total_paid: Decimal
    total_pending: Decimal
    advances_outstanding: Decimal


class DashboardKPI(BaseModel):
    year: int
    month: int
    avg_score: Decimal
    total_reward: Decimal
    pending_approvals: int


class DashboardActivity(BaseModel):
    at: datetime
    kind: str  # "attendance" | "leave" | "salary" | "kpi" | "device"
    title: str
    body: str | None = None
    employee_id: UUID | None = None
    employee_name: str | None = None


class AttendanceTrendPoint(BaseModel):
    day: date
    present: int
    late: int
    absent: int


class DashboardSummary(BaseModel):
    counts: DashboardCounts
    attendance: DashboardAttendance
    leaves: DashboardLeaves
    salary: DashboardSalary
    kpi: DashboardKPI
    recent_activity: list[DashboardActivity]
    attendance_trend: list[AttendanceTrendPoint]


__all__ = [
    "AttendanceTrendPoint",
    "DashboardActivity",
    "DashboardAttendance",
    "DashboardCounts",
    "DashboardKPI",
    "DashboardLeaves",
    "DashboardSalary",
    "DashboardSummary",
]
