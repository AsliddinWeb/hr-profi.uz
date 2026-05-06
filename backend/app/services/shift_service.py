"""Shift schedule generator.

When a ShiftTemplate is attached to an Employee (via ``Employee.shift_template_id``)
the calendar should immediately reflect the weekly pattern: PLANNED rows
on the template's working days, REST_DAY rows on the off days. Without
this, the daily-overview falls back to "NOT_SCHEDULED" for every employee
and Davomat looks empty.

The same generator runs:
  * On every employee assignment / template swap (this module).
  * On every template update that changes ``working_days`` (fan-out).
  * Daily via Celery beat to extend the rolling window forward (so the
    calendar always has the next ~60 days populated).

We never overwrite a row the admin has hand-edited (i.e. one with
``custom_start`` / ``custom_end`` set, or with status ON_LEAVE which
LeaveRequest approval stamps). Every other row gets reset to whatever
the template currently says.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Iterable
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.employee import Employee
from app.models.shift import ScheduleStatus, ShiftSchedule, ShiftTemplate

# How far ahead we keep schedules populated. 60 days is enough for 1.5
# rolling months of UI calendar; the daily celery beat task tops it up.
DEFAULT_HORIZON_DAYS = 60

# Schedule rows we never touch: leave-stamped, manually customised, or
# cancelled by an admin. Auto-regen rewrites only PLANNED + REST_DAY
# (and our own previous output).
_AUTO_REWRITE_STATUSES = {ScheduleStatus.PLANNED.value, ScheduleStatus.REST_DAY.value}


async def regenerate_employee_schedule(
    db: AsyncSession,
    *,
    employee_id: UUID,
    days_ahead: int = DEFAULT_HORIZON_DAYS,
    start: date | None = None,
) -> int:
    """Refresh PLANNED/REST_DAY rows for one employee for the next N days.

    Returns the count of rows inserted-or-updated. Caller commits.
    """
    employee = (
        await db.execute(
            select(Employee).where(Employee.id == employee_id)
        )
    ).scalar_one_or_none()
    if employee is None:
        return 0

    template: ShiftTemplate | None = None
    working_days: set[int] = set()
    if employee.shift_template_id:
        template = (
            await db.execute(
                select(ShiftTemplate).where(ShiftTemplate.id == employee.shift_template_id)
            )
        ).scalar_one_or_none()
        if template is not None and template.is_active:
            working_days = set(template.working_days or [])

    today = start or datetime.now(timezone.utc).date()
    horizon = today + timedelta(days=days_ahead)

    existing = {
        row.date: row
        for row in (
            await db.execute(
                select(ShiftSchedule).where(
                    ShiftSchedule.employee_id == employee_id,
                    ShiftSchedule.date >= today,
                    ShiftSchedule.date <= horizon,
                )
            )
        ).scalars().all()
    }

    touched = 0
    cur = today
    while cur <= horizon:
        is_workday = cur.isoweekday() in working_days
        target_status = (
            ScheduleStatus.PLANNED.value
            if is_workday and template is not None
            else ScheduleStatus.REST_DAY.value
        )
        target_template_id = template.id if (is_workday and template is not None) else None

        existing_row = existing.get(cur)
        if existing_row is None:
            db.add(
                ShiftSchedule(
                    company_id=employee.company_id,
                    employee_id=employee_id,
                    shift_template_id=target_template_id,
                    date=cur,
                    status=target_status,
                )
            )
            touched += 1
        else:
            # Skip rows the admin has hand-edited or that ON_LEAVE/CANCELLED
            # owns — only refresh our own auto-managed rows.
            current_status = (
                existing_row.status.value
                if hasattr(existing_row.status, "value")
                else str(existing_row.status)
            )
            has_custom_times = (
                existing_row.custom_start is not None
                or existing_row.custom_end is not None
            )
            if current_status in _AUTO_REWRITE_STATUSES and not has_custom_times:
                if (
                    existing_row.shift_template_id != target_template_id
                    or current_status != target_status
                ):
                    existing_row.shift_template_id = target_template_id
                    existing_row.status = target_status
                    touched += 1
        cur += timedelta(days=1)

    await db.flush()
    return touched


async def regenerate_for_employees(
    db: AsyncSession,
    employee_ids: Iterable[UUID],
    days_ahead: int = DEFAULT_HORIZON_DAYS,
) -> int:
    """Bulk variant — fan-out helper used when a template's working_days
    changes and every assigned employee needs a fresh schedule."""
    total = 0
    for emp_id in employee_ids:
        total += await regenerate_employee_schedule(
            db, employee_id=emp_id, days_ahead=days_ahead
        )
    return total


async def regenerate_for_template(
    db: AsyncSession,
    template_id: UUID,
    days_ahead: int = DEFAULT_HORIZON_DAYS,
) -> int:
    """Fan-out: every employee currently pinned to ``template_id``."""
    rows = (
        await db.execute(
            select(Employee.id).where(Employee.shift_template_id == template_id)
        )
    ).scalars().all()
    return await regenerate_for_employees(db, rows, days_ahead=days_ahead)


__all__ = [
    "DEFAULT_HORIZON_DAYS",
    "regenerate_employee_schedule",
    "regenerate_for_employees",
    "regenerate_for_template",
]
