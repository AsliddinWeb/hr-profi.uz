"""Attendance report generators."""
from __future__ import annotations

from collections import defaultdict
from datetime import date as Date
from datetime import datetime, time, timedelta, timezone
from typing import AsyncIterator
from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.attendance import AttendanceRecord, AttendanceStatus, CheckType
from app.models.branch import Branch
from app.models.department import Department
from app.models.employee import Employee
from app.models.leave import LeaveRequest, LeaveStatus
from app.models.shift import ScheduleStatus, ShiftSchedule


def _parse_date(value: str | None) -> Date | None:
    if not value:
        return None
    return Date.fromisoformat(value)


async def _branch_name_map(db: AsyncSession, company_id: UUID) -> dict[UUID, str]:
    rows = (
        await db.execute(
            select(Branch.id, Branch.name)
            .where(Branch.company_id == company_id)
            .execution_options(skip_tenant_filter=True)
        )
    ).all()
    return {r[0]: r[1] for r in rows}


async def _department_name_map(
    db: AsyncSession, company_id: UUID
) -> dict[UUID, str]:
    rows = (
        await db.execute(
            select(Department.id, Department.name)
            .where(Department.company_id == company_id)
            .execution_options(skip_tenant_filter=True)
        )
    ).all()
    return {r[0]: r[1] for r in rows}


async def attendance_daily(
    db: AsyncSession,
    company_id: UUID,
    params: dict,
    branch_filter: UUID | None,
) -> AsyncIterator[list[str]]:
    """One row per (employee × day) over a date range.

    Mandatory params: ``from`` (ISO date), ``to`` (ISO date). Optional:
    ``branch_id``, ``department_id``. ``branch_filter`` (BM) wins over
    ``branch_id`` if set.
    """
    d_from = _parse_date(params.get("from"))
    d_to = _parse_date(params.get("to"))
    if d_from is None or d_to is None:
        raise ValueError("attendance_daily.missing_date_range")
    if d_to < d_from:
        raise ValueError("attendance_daily.bad_date_range")
    if (d_to - d_from).days > 366:
        raise ValueError("attendance_daily.range_too_large")

    branch_id = branch_filter or (
        UUID(params["branch_id"]) if params.get("branch_id") else None
    )
    department_id = (
        UUID(params["department_id"]) if params.get("department_id") else None
    )

    emp_stmt = (
        select(Employee)
        .where(Employee.company_id == company_id)
        .order_by(Employee.full_name)
    )
    if branch_id is not None:
        emp_stmt = emp_stmt.where(Employee.branch_id == branch_id)
    if department_id is not None:
        emp_stmt = emp_stmt.where(Employee.department_id == department_id)
    emp_stmt = emp_stmt.execution_options(skip_tenant_filter=True)
    employees = (await db.execute(emp_stmt)).scalars().all()

    if not employees:
        yield [
            "Employee code",
            "Full name",
            "Branch",
            "Department",
            "Date",
            "First in",
            "Last out",
            "Worked (h:mm)",
            "Late (min)",
            "OT (min)",
            "Status",
        ]
        return

    emp_ids = [e.id for e in employees]
    start = datetime.combine(d_from, time.min, tzinfo=timezone.utc)
    end = datetime.combine(d_to + timedelta(days=1), time.min, tzinfo=timezone.utc)

    recs = (
        await db.execute(
            select(AttendanceRecord)
            .where(
                AttendanceRecord.employee_id.in_(emp_ids),
                AttendanceRecord.timestamp >= start,
                AttendanceRecord.timestamp < end,
                AttendanceRecord.status != AttendanceStatus.REJECTED,
            )
            .order_by(AttendanceRecord.timestamp.asc())
            .execution_options(skip_tenant_filter=True)
        )
    ).scalars().all()
    by_emp_day: dict[tuple[UUID, Date], list[AttendanceRecord]] = defaultdict(list)
    for r in recs:
        by_emp_day[(r.employee_id, r.timestamp.date())].append(r)

    leaves = (
        await db.execute(
            select(LeaveRequest)
            .where(
                LeaveRequest.employee_id.in_(emp_ids),
                LeaveRequest.status == LeaveStatus.APPROVED.value,
                LeaveRequest.start_date <= d_to,
                LeaveRequest.end_date >= d_from,
            )
            .execution_options(skip_tenant_filter=True)
        )
    ).scalars().all()
    on_leave: dict[UUID, list[tuple[Date, Date]]] = defaultdict(list)
    for lr in leaves:
        on_leave[lr.employee_id].append((lr.start_date, lr.end_date))

    sched_rows = (
        await db.execute(
            select(ShiftSchedule)
            .where(
                ShiftSchedule.employee_id.in_(emp_ids),
                ShiftSchedule.date >= d_from,
                ShiftSchedule.date <= d_to,
            )
            .execution_options(skip_tenant_filter=True)
        )
    ).scalars().all()
    sched_by: dict[tuple[UUID, Date], ShiftSchedule] = {
        (s.employee_id, s.date): s for s in sched_rows
    }

    branch_names = await _branch_name_map(db, company_id)
    dept_names = await _department_name_map(db, company_id)

    yield [
        "Employee code",
        "Full name",
        "Branch",
        "Department",
        "Date",
        "First in",
        "Last out",
        "Worked (h:mm)",
        "Late (min)",
        "OT (min)",
        "Status",
    ]

    cur = d_from
    while cur <= d_to:
        for emp in employees:
            day_recs = by_emp_day.get((emp.id, cur), [])
            first_in = next(
                (r.timestamp for r in day_recs if r.check_type == CheckType.CHECK_IN),
                None,
            )
            last_out = next(
                (
                    r.timestamp
                    for r in reversed(day_recs)
                    if r.check_type == CheckType.CHECK_OUT
                ),
                None,
            )
            worked = 0
            late_min = 0
            ot_min = 0
            pending_in: datetime | None = None
            for r in day_recs:
                if r.check_type == CheckType.CHECK_IN:
                    pending_in = r.timestamp
                    late_min += int(r.late_minutes or 0)
                elif r.check_type == CheckType.CHECK_OUT:
                    if pending_in is not None:
                        worked += int((r.timestamp - pending_in).total_seconds() // 60)
                        pending_in = None
                    ot_min += int(r.overtime_minutes or 0)

            on_leave_today = any(s <= cur <= e for s, e in on_leave.get(emp.id, []))
            sched = sched_by.get((emp.id, cur))
            if on_leave_today:
                status_label = "ON_LEAVE"
            elif sched and sched.status == ScheduleStatus.REST_DAY.value:
                status_label = "REST_DAY"
            elif first_in is None:
                # Match the live overview convention: weekday past = ABSENT,
                # else NOT_SCHEDULED. We don't pull company.working_days
                # here for simplicity — falls back to "ABSENT" when there
                # was no schedule and no check-in but the day is past.
                today = datetime.now(timezone.utc).date()
                status_label = "ABSENT" if cur < today else "NOT_SCHEDULED"
            elif late_min > 0:
                status_label = "LATE"
            else:
                status_label = "PRESENT"

            yield [
                emp.employee_code,
                emp.full_name or "",
                branch_names.get(emp.branch_id, "") if emp.branch_id else "",
                dept_names.get(emp.department_id, "") if emp.department_id else "",
                cur.isoformat(),
                first_in.isoformat() if first_in else "",
                last_out.isoformat() if last_out else "",
                f"{worked // 60}:{str(worked % 60).zfill(2)}",
                str(late_min),
                str(ot_min),
                status_label,
            ]
        cur += timedelta(days=1)


async def attendance_monthly(
    db: AsyncSession,
    company_id: UUID,
    params: dict,
    branch_filter: UUID | None,
) -> AsyncIterator[list[str]]:
    """One row per employee with monthly aggregates.

    Params: ``year``, ``month``, optional ``branch_id``, ``department_id``.
    """
    year = int(params.get("year") or 0)
    month = int(params.get("month") or 0)
    if not (1 <= month <= 12 and 2000 <= year <= 2100):
        raise ValueError("attendance_monthly.bad_year_month")

    d_from = Date(year, month, 1)
    d_to = (
        Date(year + 1, 1, 1) if month == 12 else Date(year, month + 1, 1)
    ) - timedelta(days=1)
    inner_params = {
        "from": d_from.isoformat(),
        "to": d_to.isoformat(),
        **{k: params[k] for k in ("branch_id", "department_id") if k in params},
    }

    headers_emitted = False
    aggregates: dict[
        UUID, dict[str, object]
    ] = {}
    headers_buffer: list[str] = []
    async for row in attendance_daily(
        db, company_id, inner_params, branch_filter
    ):
        if not headers_emitted:
            headers_buffer = list(row)
            headers_emitted = True
            continue
        emp_code = row[0]
        agg = aggregates.setdefault(
            emp_code,
            {
                "code": row[0],
                "name": row[1],
                "branch": row[2],
                "department": row[3],
                "days_worked": 0,
                "minutes_worked": 0,
                "late_minutes": 0,
                "ot_minutes": 0,
                "absent_days": 0,
                "leave_days": 0,
                "rest_days": 0,
            },
        )
        worked_str = row[7]
        late = int(row[8] or 0)
        ot = int(row[9] or 0)
        status = row[10]
        h, m = worked_str.split(":")
        worked_min = int(h) * 60 + int(m)
        if worked_min > 0:
            agg["days_worked"] = int(agg["days_worked"]) + 1
        agg["minutes_worked"] = int(agg["minutes_worked"]) + worked_min
        agg["late_minutes"] = int(agg["late_minutes"]) + late
        agg["ot_minutes"] = int(agg["ot_minutes"]) + ot
        if status == "ABSENT":
            agg["absent_days"] = int(agg["absent_days"]) + 1
        elif status == "ON_LEAVE":
            agg["leave_days"] = int(agg["leave_days"]) + 1
        elif status == "REST_DAY":
            agg["rest_days"] = int(agg["rest_days"]) + 1

    yield [
        "Employee code",
        "Full name",
        "Branch",
        "Department",
        "Year-Month",
        "Days worked",
        "Total hours",
        "Late (min)",
        "OT (min)",
        "Absent days",
        "Leave days",
        "Rest days",
    ]
    ym = f"{year}-{month:02d}"
    # Preserve "name" sort like the daily report (employees iterated in
    # full_name order). Stable since we built dict in iteration order.
    for v in aggregates.values():
        worked_min = int(v["minutes_worked"])
        yield [
            str(v["code"]),
            str(v["name"]),
            str(v["branch"]),
            str(v["department"]),
            ym,
            str(v["days_worked"]),
            f"{worked_min // 60}:{str(worked_min % 60).zfill(2)}",
            str(v["late_minutes"]),
            str(v["ot_minutes"]),
            str(v["absent_days"]),
            str(v["leave_days"]),
            str(v["rest_days"]),
        ]
