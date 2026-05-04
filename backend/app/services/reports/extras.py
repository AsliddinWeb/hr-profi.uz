"""Phase-3 report generators: KPI / leave balance / bonus-deduction / late-absence."""
from __future__ import annotations

from collections import defaultdict
from datetime import date as Date
from datetime import datetime, time, timedelta, timezone
from decimal import Decimal
from typing import AsyncIterator
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.attendance import AttendanceRecord, AttendanceStatus, CheckType
from app.models.bonus_deduction import Bonus, Deduction
from app.models.branch import Branch
from app.models.department import Department
from app.models.employee import Employee
from app.models.kpi import KPIAssignment, KPITemplate
from app.models.leave import LeaveAdjustment, LeaveRequest, LeaveStatus, LeaveType


def _parse_date(value: str | None) -> Date | None:
    if not value:
        return None
    return Date.fromisoformat(value)


async def _branch_dept_maps(
    db: AsyncSession, company_id: UUID
) -> tuple[dict[UUID, str], dict[UUID, str]]:
    branches = {
        r[0]: r[1]
        for r in (
            await db.execute(
                select(Branch.id, Branch.name)
                .where(Branch.company_id == company_id)
                .execution_options(skip_tenant_filter=True)
            )
        ).all()
    }
    departments = {
        r[0]: r[1]
        for r in (
            await db.execute(
                select(Department.id, Department.name)
                .where(Department.company_id == company_id)
                .execution_options(skip_tenant_filter=True)
            )
        ).all()
    }
    return branches, departments


# ---------- KPI summary -----------------------------------------------------


async def kpi_summary(
    db: AsyncSession,
    company_id: UUID,
    params: dict,
    branch_filter: UUID | None,
) -> AsyncIterator[list[str]]:
    """Per-employee KPI summary for one month.

    Aggregates: avg score across all assigned KPIs, total computed_reward
    (positive sum), total penalty (computed_reward where is_penalty),
    count of assignments by status. One row per employee that has at
    least one KPI in that month.
    """
    year = int(params.get("year") or 0)
    month = int(params.get("month") or 0)
    if not (1 <= month <= 12 and 2000 <= year <= 2100):
        raise ValueError("kpi_summary.bad_year_month")

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
    emp_ids = [e.id for e in employees]

    branches, departments = await _branch_dept_maps(db, company_id)

    yield [
        "Employee code",
        "Full name",
        "Branch",
        "Department",
        "Year-Month",
        "Assignments",
        "Avg score (%)",
        "Approved",
        "Pending",
        "Total reward",
        "Total penalty",
    ]

    if not emp_ids:
        return

    rows = (
        await db.execute(
            select(KPIAssignment, KPITemplate)
            .join(KPITemplate, KPITemplate.id == KPIAssignment.kpi_template_id)
            .where(
                KPIAssignment.employee_id.in_(emp_ids),
                KPIAssignment.year == year,
                KPIAssignment.month == month,
            )
            .execution_options(skip_tenant_filter=True)
        )
    ).all()
    by_emp: dict[UUID, list[tuple[KPIAssignment, KPITemplate]]] = defaultdict(list)
    for asn, tpl in rows:
        by_emp[asn.employee_id].append((asn, tpl))

    ym = f"{year}-{month:02d}"
    for e in employees:
        items = by_emp.get(e.id, [])
        if not items:
            continue
        scores = [float(a.score or 0) for a, _ in items]
        avg = sum(scores) / len(scores) if scores else 0
        approved = sum(
            1 for a, _ in items if str(a.status) in ("APPROVED", "PAID")
        )
        pending = sum(
            1 for a, _ in items if str(a.status) in ("ACTIVE", "COMPUTED")
        )
        reward = sum(
            float(a.computed_reward or 0) for a, _ in items if not a.is_penalty
        )
        penalty = sum(
            float(a.computed_reward or 0) for a, _ in items if a.is_penalty
        )
        yield [
            e.employee_code,
            e.full_name or "",
            branches.get(e.branch_id, "") if e.branch_id else "",
            departments.get(e.department_id, "") if e.department_id else "",
            ym,
            str(len(items)),
            f"{avg:.1f}",
            str(approved),
            str(pending),
            str(int(round(reward))),
            str(int(round(penalty))),
        ]


# ---------- Leave balance ---------------------------------------------------


async def leave_balance(
    db: AsyncSession,
    company_id: UUID,
    params: dict,
    branch_filter: UUID | None,
) -> AsyncIterator[list[str]]:
    """Annual leave balance per (employee, leave type).

    Re-uses the same arithmetic as ``GET /leave-requests/balances`` but
    flattens to a CSV-friendly grid: one row per (employee × leave_type),
    including remaining days when the type has a yearly cap.
    """
    year = int(params.get("year") or datetime.now(timezone.utc).year)
    if not (2000 <= year <= 2100):
        raise ValueError("leave_balance.bad_year")

    branch_id = branch_filter or (
        UUID(params["branch_id"]) if params.get("branch_id") else None
    )

    emp_stmt = (
        select(Employee)
        .where(
            Employee.company_id == company_id,
            Employee.is_active.is_(True),
        )
        .order_by(Employee.full_name)
    )
    if branch_id is not None:
        emp_stmt = emp_stmt.where(Employee.branch_id == branch_id)
    emp_stmt = emp_stmt.execution_options(skip_tenant_filter=True)
    employees = (await db.execute(emp_stmt)).scalars().all()

    types = (
        await db.execute(
            select(LeaveType)
            .where(LeaveType.company_id == company_id, LeaveType.is_active.is_(True))
            .order_by(LeaveType.name)
            .execution_options(skip_tenant_filter=True)
        )
    ).scalars().all()
    type_by_id = {t.id: t for t in types}

    branches, _ = await _branch_dept_maps(db, company_id)

    yield [
        "Employee code",
        "Full name",
        "Branch",
        "Year",
        "Leave type",
        "Paid",
        "Annual cap",
        "Used (days)",
        "Remaining",
    ]

    if not employees or not types:
        return

    year_start = Date(year, 1, 1)
    year_end = Date(year, 12, 31)
    leaves = (
        await db.execute(
            select(LeaveRequest)
            .where(
                LeaveRequest.employee_id.in_([e.id for e in employees]),
                LeaveRequest.status == LeaveStatus.APPROVED.value,
                LeaveRequest.start_date <= year_end,
                LeaveRequest.end_date >= year_start,
            )
            .execution_options(skip_tenant_filter=True)
        )
    ).scalars().all()

    used: dict[tuple[UUID, UUID], int] = defaultdict(int)
    for lr in leaves:
        s = max(lr.start_date, year_start)
        e = min(lr.end_date, year_end)
        d = (e - s).days + 1
        if d > 0:
            used[(lr.employee_id, lr.leave_type_id)] += d

    adjustments = (
        await db.execute(
            select(LeaveAdjustment)
            .where(
                LeaveAdjustment.company_id == company_id,
                LeaveAdjustment.year == year,
            )
            .execution_options(skip_tenant_filter=True)
        )
    ).scalars().all()
    for a in adjustments:
        used[(a.employee_id, a.leave_type_id)] += int(a.days_delta or 0)

    for emp in employees:
        for lt in types:
            u = used.get((emp.id, lt.id), 0)
            cap = lt.max_days_per_year
            remaining = "" if cap is None else str(cap - u)
            yield [
                emp.employee_code,
                emp.full_name or "",
                branches.get(emp.branch_id, "") if emp.branch_id else "",
                str(year),
                lt.name,
                "1" if lt.paid else "0",
                str(cap) if cap is not None else "—",
                str(u),
                remaining,
            ]


# ---------- Bonus / deduction register --------------------------------------


async def bonus_deduction_register(
    db: AsyncSession,
    company_id: UUID,
    params: dict,
    branch_filter: UUID | None,
) -> AsyncIterator[list[str]]:
    """All bonuses + deductions in a date range, sorted newest first.

    Single combined feed (one CSV instead of two) so the admin can scan
    the financial activity in one place. The ``Direction`` column flags
    BONUS (+) vs DEDUCTION (−).
    """
    d_from = _parse_date(params.get("from"))
    d_to = _parse_date(params.get("to"))
    if d_from is None or d_to is None:
        raise ValueError("bonus_deduction_register.missing_date_range")
    if d_to < d_from:
        raise ValueError("bonus_deduction_register.bad_date_range")

    branch_id = branch_filter or (
        UUID(params["branch_id"]) if params.get("branch_id") else None
    )

    emp_stmt = (
        select(Employee)
        .where(Employee.company_id == company_id)
    )
    if branch_id is not None:
        emp_stmt = emp_stmt.where(Employee.branch_id == branch_id)
    emp_stmt = emp_stmt.execution_options(skip_tenant_filter=True)
    employees = (await db.execute(emp_stmt)).scalars().all()
    emp_by_id = {e.id: e for e in employees}
    emp_ids = list(emp_by_id.keys())

    branches, _ = await _branch_dept_maps(db, company_id)

    yield [
        "Date",
        "Direction",
        "Employee code",
        "Full name",
        "Branch",
        "Type",
        "Amount",
        "Auto",
        "Reason",
    ]

    if not emp_ids:
        return

    bonuses = (
        await db.execute(
            select(Bonus)
            .where(
                Bonus.employee_id.in_(emp_ids),
                Bonus.applied_date >= d_from,
                Bonus.applied_date <= d_to,
            )
            .execution_options(skip_tenant_filter=True)
        )
    ).scalars().all()
    deductions = (
        await db.execute(
            select(Deduction)
            .where(
                Deduction.employee_id.in_(emp_ids),
                Deduction.applied_date >= d_from,
                Deduction.applied_date <= d_to,
            )
            .execution_options(skip_tenant_filter=True)
        )
    ).scalars().all()

    combined: list[tuple[Date, str, str, str, str, str, str, str]] = []
    for b in bonuses:
        emp = emp_by_id.get(b.employee_id)
        if not emp:
            continue
        combined.append(
            (
                b.applied_date,
                "BONUS",
                emp.employee_code,
                emp.full_name or "",
                branches.get(emp.branch_id, "") if emp.branch_id else "",
                str(b.type.value if hasattr(b.type, "value") else b.type),
                str(int(round(float(b.amount or 0)))),
                "1" if b.auto_generated else "0",
                (b.reason or "")[:200],
            )
        )
    for d in deductions:
        emp = emp_by_id.get(d.employee_id)
        if not emp:
            continue
        combined.append(
            (
                d.applied_date,
                "DEDUCTION",
                emp.employee_code,
                emp.full_name or "",
                branches.get(emp.branch_id, "") if emp.branch_id else "",
                str(d.type.value if hasattr(d.type, "value") else d.type),
                "-" + str(int(round(float(d.amount or 0)))),
                "1" if d.auto_generated else "0",
                (d.reason or "")[:200],
            )
        )

    combined.sort(key=lambda x: (x[0], x[1]), reverse=True)
    for row in combined:
        yield [str(row[0])] + [r if isinstance(r, str) else str(r) for r in row[1:]]


# ---------- Late / absence trend --------------------------------------------


async def late_absence_trend(
    db: AsyncSession,
    company_id: UUID,
    params: dict,
    branch_filter: UUID | None,
) -> AsyncIterator[list[str]]:
    """Per-employee late + absence counts over a date range.

    Useful for HR's monthly performance review: who's racking up late
    minutes, who's absent disproportionately. The "Absence days" count
    is approximate (we count days with no check-in that fall within
    the working_days set), matching the live overview's logic.
    """
    d_from = _parse_date(params.get("from"))
    d_to = _parse_date(params.get("to"))
    if d_from is None or d_to is None:
        raise ValueError("late_absence_trend.missing_date_range")
    if d_to < d_from:
        raise ValueError("late_absence_trend.bad_date_range")
    if (d_to - d_from).days > 366:
        raise ValueError("late_absence_trend.range_too_large")

    branch_id = branch_filter or (
        UUID(params["branch_id"]) if params.get("branch_id") else None
    )

    emp_stmt = (
        select(Employee)
        .where(
            Employee.company_id == company_id,
            Employee.is_active.is_(True),
        )
        .order_by(Employee.full_name)
    )
    if branch_id is not None:
        emp_stmt = emp_stmt.where(Employee.branch_id == branch_id)
    emp_stmt = emp_stmt.execution_options(skip_tenant_filter=True)
    employees = (await db.execute(emp_stmt)).scalars().all()
    emp_by_id = {e.id: e for e in employees}
    emp_ids = list(emp_by_id.keys())

    branches, _ = await _branch_dept_maps(db, company_id)

    yield [
        "Employee code",
        "Full name",
        "Branch",
        "Date range",
        "Late count",
        "Late minutes",
        "Avg late (min)",
        "Absent days",
        "Worst day late (min)",
    ]

    if not emp_ids:
        return

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
                AttendanceRecord.check_type == CheckType.CHECK_IN,
            )
            .execution_options(skip_tenant_filter=True)
        )
    ).scalars().all()
    days_with_in: dict[UUID, set[Date]] = defaultdict(set)
    late_by_emp: dict[UUID, list[int]] = defaultdict(list)
    for r in recs:
        days_with_in[r.employee_id].add(r.timestamp.date())
        if r.is_late:
            late_by_emp[r.employee_id].append(int(r.late_minutes or 0))

    # Approved leaves to suppress absence-count for those days.
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
    on_leave_days: dict[UUID, set[Date]] = defaultdict(set)
    for lr in leaves:
        s = max(lr.start_date, d_from)
        e = min(lr.end_date, d_to)
        cur = s
        while cur <= e:
            on_leave_days[lr.employee_id].add(cur)
            cur += timedelta(days=1)

    # Working day check — Mon-Fri default.
    working_iso = {1, 2, 3, 4, 5}
    range_label = f"{d_from.isoformat()} → {d_to.isoformat()}"
    for emp in employees:
        late_list = late_by_emp.get(emp.id, [])
        late_count = len(late_list)
        late_total = sum(late_list)
        late_avg = (late_total / late_count) if late_count else 0
        worst = max(late_list) if late_list else 0

        absent = 0
        cur = d_from
        while cur <= d_to:
            if cur.isoweekday() in working_iso:
                if cur not in days_with_in.get(emp.id, set()) and cur not in on_leave_days.get(emp.id, set()):
                    absent += 1
            cur += timedelta(days=1)

        if late_count == 0 and absent == 0:
            continue  # only surface employees with at least one issue

        yield [
            emp.employee_code,
            emp.full_name or "",
            branches.get(emp.branch_id, "") if emp.branch_id else "",
            range_label,
            str(late_count),
            str(late_total),
            f"{late_avg:.1f}",
            str(absent),
            str(worst),
        ]
