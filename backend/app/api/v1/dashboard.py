"""Cross-module dashboard summary for the company admin home page.

Single endpoint that joins counts, attendance state, leave pipeline, salary
totals and KPI scores so the front-end shows a complete picture in one
round trip. Heavy queries are kept SQL-side so we don't ship raw rows.
"""
from __future__ import annotations

from datetime import datetime, time, timedelta, timezone
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, distinct, extract, func, select

from app.core.deps import CurrentUser, DbDep, TenantId, require_permission
from app.core.exceptions import PermissionDeniedError
from app.models.attendance import (
    AttendanceRecord,
    AttendanceStatus,
    CheckType,
)
from app.models.bonus_deduction import Deduction, DeductionType
from app.models.branch import Branch
from app.models.department import Department
from app.models.device import Device, DeviceStatus
from app.models.employee import Employee
from app.models.kpi import KPIAssignment, KPIAssignmentStatus
from app.models.leave import LeaveRequest, LeaveStatus
from app.models.salary import SalaryPeriod
from app.models.shift import ScheduleStatus, ShiftSchedule
from app.schemas.dashboard import (
    AttendanceTrendPoint,
    DashboardActivity,
    DashboardAttendance,
    DashboardCounts,
    DashboardKPI,
    DashboardLeaves,
    DashboardSalary,
    DashboardSummary,
)

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


def _company_id(user, tenant) -> UUID:
    cid = tenant or user.company_id
    if cid is None:
        raise PermissionDeniedError()
    return cid


@router.get(
    "/summary",
    response_model=DashboardSummary,
    dependencies=[Depends(require_permission("company.read"))],
)
async def summary(
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
    trend_days: int = Query(7, ge=1, le=30),
    activity_limit: int = Query(15, ge=1, le=50),
) -> DashboardSummary:
    company_id = _company_id(user, tenant)
    today = datetime.now(timezone.utc).date()
    today_start = datetime.combine(today, time.min, tzinfo=timezone.utc)
    today_end = today_start + timedelta(days=1)
    month_start = today.replace(day=1)

    # ---- Counts: employees / branches / departments / devices --------------

    counts_row = (
        await db.execute(
            select(
                func.coalesce(
                    func.sum(case((Employee.is_active.is_(True), 1), else_=0)), 0
                ),
                func.count(Employee.id),
            ).where(Employee.company_id == company_id)
        )
    ).one()
    employees_active = int(counts_row[0] or 0)
    employees_total = int(counts_row[1] or 0)

    branches_count = (
        await db.execute(
            select(func.count(Branch.id)).where(Branch.company_id == company_id)
        )
    ).scalar_one()
    departments_count = (
        await db.execute(
            select(func.count(Department.id)).where(
                Department.company_id == company_id
            )
        )
    ).scalar_one()

    device_row = (
        await db.execute(
            select(
                func.coalesce(
                    func.sum(case((Device.status == DeviceStatus.ONLINE, 1), else_=0)),
                    0,
                ),
                func.coalesce(
                    func.sum(case((Device.status == DeviceStatus.OFFLINE, 1), else_=0)),
                    0,
                ),
                func.count(Device.id),
            ).where(Device.company_id == company_id, Device.is_active.is_(True))
        )
    ).one()
    counts = DashboardCounts(
        employees_active=employees_active,
        employees_total=employees_total,
        branches=int(branches_count or 0),
        departments=int(departments_count or 0),
        devices_online=int(device_row[0] or 0),
        devices_offline=int(device_row[1] or 0),
        devices_total=int(device_row[2] or 0),
    )

    # ---- Attendance: today snapshot ----------------------------------------
    # Distinct employees with non-rejected check-in today.
    present_today = (
        await db.execute(
            select(
                func.count(distinct(AttendanceRecord.employee_id))
            ).where(
                AttendanceRecord.company_id == company_id,
                AttendanceRecord.check_type == CheckType.CHECK_IN,
                AttendanceRecord.status != AttendanceStatus.REJECTED,
                AttendanceRecord.timestamp >= today_start,
                AttendanceRecord.timestamp < today_end,
            )
        )
    ).scalar_one()

    # Distinct late employees (any late check-in).
    late_today = (
        await db.execute(
            select(
                func.count(distinct(AttendanceRecord.employee_id))
            ).where(
                AttendanceRecord.company_id == company_id,
                AttendanceRecord.check_type == CheckType.CHECK_IN,
                AttendanceRecord.is_late.is_(True),
                AttendanceRecord.timestamp >= today_start,
                AttendanceRecord.timestamp < today_end,
            )
        )
    ).scalar_one()

    # Currently working = had check-in but no later check-out today.
    current_in = (
        await db.execute(
            select(
                AttendanceRecord.employee_id,
                AttendanceRecord.check_type,
                AttendanceRecord.timestamp,
            ).where(
                AttendanceRecord.company_id == company_id,
                AttendanceRecord.timestamp >= today_start,
                AttendanceRecord.timestamp < today_end,
                AttendanceRecord.status != AttendanceStatus.REJECTED,
            )
            .order_by(AttendanceRecord.employee_id, AttendanceRecord.timestamp.desc())
        )
    ).all()
    last_by_emp: dict = {}
    for emp_id, ct, _ in current_in:
        if emp_id not in last_by_emp:
            last_by_emp[emp_id] = ct
    currently_working = sum(
        1 for ct in last_by_emp.values() if ct == CheckType.CHECK_IN
    )

    # Rest day count: employees scheduled REST_DAY today.
    rest_today = (
        await db.execute(
            select(func.count(ShiftSchedule.id)).where(
                ShiftSchedule.company_id == company_id,
                ShiftSchedule.date == today,
                ShiftSchedule.status == ScheduleStatus.REST_DAY,
            )
        )
    ).scalar_one()

    # Absent = active employees with no scheduled REST and no check-in today.
    absent_today = max(
        0, employees_active - int(present_today) - int(rest_today or 0)
    )

    overtime_minutes_today = (
        await db.execute(
            select(func.coalesce(func.sum(AttendanceRecord.overtime_minutes), 0))
            .where(
                AttendanceRecord.company_id == company_id,
                AttendanceRecord.timestamp >= today_start,
                AttendanceRecord.timestamp < today_end,
            )
        )
    ).scalar_one()

    attendance = DashboardAttendance(
        present_today=int(present_today or 0),
        late_today=int(late_today or 0),
        absent_today=absent_today,
        rest_today=int(rest_today or 0),
        currently_working=currently_working,
        overtime_minutes_today=int(overtime_minutes_today or 0),
    )

    # ---- Leaves: pending + this month decisions ----------------------------

    leaves_row = (
        await db.execute(
            select(
                func.coalesce(
                    func.sum(case((LeaveRequest.status == LeaveStatus.PENDING, 1), else_=0)),
                    0,
                ),
                func.coalesce(
                    func.sum(
                        case(
                            (
                                (LeaveRequest.status == LeaveStatus.APPROVED)
                                & (extract("year", LeaveRequest.created_at) == today.year)
                                & (extract("month", LeaveRequest.created_at) == today.month),
                                1,
                            ),
                            else_=0,
                        )
                    ),
                    0,
                ),
                func.coalesce(
                    func.sum(
                        case(
                            (
                                (LeaveRequest.status == LeaveStatus.REJECTED)
                                & (extract("year", LeaveRequest.created_at) == today.year)
                                & (extract("month", LeaveRequest.created_at) == today.month),
                                1,
                            ),
                            else_=0,
                        )
                    ),
                    0,
                ),
            ).where(LeaveRequest.company_id == company_id)
        )
    ).one()
    leaves = DashboardLeaves(
        pending_count=int(leaves_row[0] or 0),
        approved_this_month=int(leaves_row[1] or 0),
        rejected_this_month=int(leaves_row[2] or 0),
    )

    # ---- Salary: this month totals -----------------------------------------

    salary_row = (
        await db.execute(
            select(
                func.coalesce(func.sum(SalaryPeriod.total_earned), 0),
                func.coalesce(func.sum(SalaryPeriod.paid_amount), 0),
            ).where(
                SalaryPeriod.company_id == company_id,
                SalaryPeriod.year == today.year,
                SalaryPeriod.month == today.month,
            )
        )
    ).one()
    total_earned = Decimal(salary_row[0] or 0)
    total_paid = Decimal(salary_row[1] or 0)
    advances = (
        await db.execute(
            select(func.coalesce(func.sum(Deduction.amount), 0)).where(
                Deduction.company_id == company_id,
                Deduction.type == DeductionType.ADVANCE.value,
                extract("year", Deduction.applied_date) == today.year,
                extract("month", Deduction.applied_date) == today.month,
            )
        )
    ).scalar_one()
    salary = DashboardSalary(
        year=today.year,
        month=today.month,
        total_earned=total_earned,
        total_paid=total_paid,
        total_pending=(total_earned - total_paid).quantize(Decimal("0.01")),
        advances_outstanding=Decimal(advances or 0),
    )

    # ---- KPI: this month avg + pending approvals ---------------------------

    kpi_row = (
        await db.execute(
            select(
                func.coalesce(func.avg(KPIAssignment.score), 0),
                func.coalesce(
                    func.sum(
                        case(
                            (KPIAssignment.is_penalty.is_(False), KPIAssignment.computed_reward),
                            else_=0,
                        )
                    ),
                    0,
                ),
                func.coalesce(
                    func.sum(
                        case(
                            (KPIAssignment.status == KPIAssignmentStatus.COMPUTED.value, 1),
                            else_=0,
                        )
                    ),
                    0,
                ),
            ).where(
                KPIAssignment.company_id == company_id,
                KPIAssignment.year == today.year,
                KPIAssignment.month == today.month,
            )
        )
    ).one()
    kpi = DashboardKPI(
        year=today.year,
        month=today.month,
        avg_score=Decimal(kpi_row[0] or 0).quantize(Decimal("0.01")),
        total_reward=Decimal(kpi_row[1] or 0),
        pending_approvals=int(kpi_row[2] or 0),
    )

    # ---- Attendance trend (last N days) ------------------------------------

    trend_start = today - timedelta(days=trend_days - 1)
    trend_start_dt = datetime.combine(trend_start, time.min, tzinfo=timezone.utc)
    trend_rows = (
        await db.execute(
            select(
                func.date(AttendanceRecord.timestamp).label("day"),
                func.count(distinct(AttendanceRecord.employee_id)).label("present"),
                func.coalesce(
                    func.sum(
                        case(
                            (AttendanceRecord.is_late.is_(True), 1),
                            else_=0,
                        )
                    ),
                    0,
                ).label("late"),
            )
            .where(
                AttendanceRecord.company_id == company_id,
                AttendanceRecord.check_type == CheckType.CHECK_IN,
                AttendanceRecord.status != AttendanceStatus.REJECTED,
                AttendanceRecord.timestamp >= trend_start_dt,
                AttendanceRecord.timestamp < today_end,
            )
            .group_by(func.date(AttendanceRecord.timestamp))
            .order_by(func.date(AttendanceRecord.timestamp))
        )
    ).all()
    by_day = {r[0]: (int(r[1]), int(r[2])) for r in trend_rows}
    attendance_trend: list[AttendanceTrendPoint] = []
    for i in range(trend_days):
        day = trend_start + timedelta(days=i)
        present, late = by_day.get(day, (0, 0))
        absent = max(0, employees_active - present)
        attendance_trend.append(
            AttendanceTrendPoint(day=day, present=present, late=late, absent=absent)
        )

    # ---- Recent activity (last 24h, capped) --------------------------------

    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    activity: list[DashboardActivity] = []

    # Latest leaves
    leaves_recent = (
        await db.execute(
            select(LeaveRequest, Employee)
            .join(Employee, Employee.id == LeaveRequest.employee_id)
            .where(
                LeaveRequest.company_id == company_id,
                LeaveRequest.created_at >= cutoff,
            )
            .order_by(LeaveRequest.created_at.desc())
            .limit(activity_limit)
        )
    ).all()
    for lr, emp in leaves_recent:
        activity.append(
            DashboardActivity(
                at=lr.created_at,
                kind="leave",
                title=f"Leave {lr.status if isinstance(lr.status, str) else lr.status.value}",
                body=f"{lr.start_date} → {lr.end_date}",
                employee_id=emp.id,
                employee_name=emp.full_name,
            )
        )

    # Latest attendance check-ins
    att_recent = (
        await db.execute(
            select(AttendanceRecord, Employee)
            .join(Employee, Employee.id == AttendanceRecord.employee_id)
            .where(
                AttendanceRecord.company_id == company_id,
                AttendanceRecord.timestamp >= cutoff,
            )
            .order_by(AttendanceRecord.timestamp.desc())
            .limit(activity_limit)
        )
    ).all()
    for r, emp in att_recent:
        activity.append(
            DashboardActivity(
                at=r.timestamp,
                kind="attendance",
                title=str(
                    r.check_type if isinstance(r.check_type, str) else r.check_type.value
                ),
                body=("LATE" if r.is_late else None),
                employee_id=emp.id,
                employee_name=emp.full_name,
            )
        )

    activity.sort(key=lambda a: a.at, reverse=True)
    activity = activity[:activity_limit]

    return DashboardSummary(
        counts=counts,
        attendance=attendance,
        leaves=leaves,
        salary=salary,
        kpi=kpi,
        recent_activity=activity,
        attendance_trend=attendance_trend,
    )
