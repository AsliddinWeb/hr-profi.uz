"""Recompute ``late_minutes`` / ``overtime_minutes`` / ``is_late`` on
every AttendanceRecord row using the current (timezone-fixed) logic.

Why: before the Tashkent-tz fix, the late-detection code treated
``ShiftTemplate.start_time`` as UTC, so a 09:00-local shift was
compared against now-UTC, producing inflated late_minutes (a 16:10
check-in showed up as 130+ minutes late instead of "early by hours").
Those bad numbers are still on disk, and the auto LATE deduction
multiplies them by ``late_penalty_per_min`` → bogus fines on the
salary page.

This script:
  1. Iterates every CHECK_IN / CHECK_OUT AttendanceRecord.
  2. Re-derives the day's scheduled template via ShiftSchedule (or the
     employee's default), recomputes is_late / late_minutes /
     overtime_minutes in *local* Tashkent time.
  3. Writes the new values; commits in batches.
  4. After the records are corrected, enqueues a salary recompute for
     every (employee, day) touched so the LATE/ABSENCE deductions
     refresh.

Run once from inside the api container:

    docker compose ... exec api python -m scripts.recompute_attendance_lateness

Idempotent — safe to re-run.
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.attendance import AttendanceRecord, CheckType
from app.models.employee import Employee
from app.models.shift import ShiftSchedule, ShiftTemplate


TZ_LOCAL = ZoneInfo(settings.tz)


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--company-id", help="Limit to a single company UUID."
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Don't write, just report."
    )
    args = parser.parse_args()

    touched = 0
    cleared = 0
    recomputed: set[tuple[str, str]] = set()  # (employee_id, day-iso)

    async with AsyncSessionLocal() as db:
        stmt = (
            select(AttendanceRecord)
            .order_by(AttendanceRecord.timestamp.asc())
            .execution_options(skip_tenant_filter=True)
        )
        if args.company_id:
            stmt = stmt.where(AttendanceRecord.company_id == args.company_id)
        rows = (await db.execute(stmt)).scalars().all()

        for rec in rows:
            # Re-derive the day's scheduled template the same way
            # attendance_service does it: ShiftSchedule row first,
            # employee.shift_template_id as fallback.
            local_ts = rec.timestamp.astimezone(TZ_LOCAL)
            day = local_ts.date()

            sched = (
                await db.execute(
                    select(ShiftSchedule)
                    .where(
                        ShiftSchedule.employee_id == rec.employee_id,
                        ShiftSchedule.date == day,
                    )
                    .execution_options(skip_tenant_filter=True)
                )
            ).scalar_one_or_none()

            template_id = sched.shift_template_id if sched else None
            if template_id is None:
                emp = (
                    await db.execute(
                        select(Employee)
                        .where(Employee.id == rec.employee_id)
                        .execution_options(skip_tenant_filter=True)
                    )
                ).scalar_one_or_none()
                if emp is not None:
                    template_id = emp.shift_template_id

            tpl = None
            if template_id is not None:
                tpl = (
                    await db.execute(
                        select(ShiftTemplate)
                        .where(ShiftTemplate.id == template_id)
                        .execution_options(skip_tenant_filter=True)
                    )
                ).scalar_one_or_none()

            new_is_late = False
            new_late = 0
            new_ot = 0
            new_early = False

            if rec.check_type == CheckType.CHECK_IN:
                if tpl and tpl.start_time is not None:
                    scheduled_local = datetime.combine(
                        day, tpl.start_time, tzinfo=TZ_LOCAL
                    )
                    diff = (local_ts - scheduled_local).total_seconds() / 60
                    if diff > 0:
                        new_late = int(diff)
                        new_is_late = True
            else:  # CHECK_OUT
                if tpl and tpl.end_time is not None:
                    scheduled_end_local = datetime.combine(
                        day, tpl.end_time, tzinfo=TZ_LOCAL
                    )
                    diff_min = (local_ts - scheduled_end_local).total_seconds() / 60
                    if diff_min > 0 and tpl.allow_overtime:
                        new_ot = int(diff_min)
                    elif diff_min < 0:
                        new_early = True

            # Did anything change? Compare carefully — small drifts in
            # how we round don't count.
            changed = (
                rec.is_late != new_is_late
                or int(rec.late_minutes or 0) != new_late
                or int(rec.overtime_minutes or 0) != new_ot
                or rec.is_early_leave != new_early
            )
            if not changed:
                continue

            touched += 1
            if int(rec.late_minutes or 0) > 0 and new_late == 0:
                cleared += 1

            if not args.dry_run:
                rec.is_late = new_is_late
                rec.late_minutes = new_late
                rec.overtime_minutes = new_ot
                rec.is_early_leave = new_early

            recomputed.add((str(rec.employee_id), day.isoformat()))

            if touched % 200 == 0 and not args.dry_run:
                await db.commit()

        if not args.dry_run:
            await db.commit()

    print(
        f"[recompute] records touched: {touched} "
        f"(cleared {cleared} bogus-late rows). "
        f"dry-run={args.dry_run}"
    )

    if args.dry_run:
        return 0

    # Re-fire salary recompute so LATE/ABSENCE deductions catch up to
    # the corrected attendance records. Lazy import so a missing broker
    # doesn't block the records-fix part of the script.
    try:
        from app.tasks.salary_tasks import recompute_for_day
    except Exception as e:  # noqa: BLE001
        print(f"[recompute] salary task import failed: {e}", file=sys.stderr)
        return 0

    dispatched = 0
    for emp_id, day_iso in recomputed:
        try:
            recompute_for_day.delay(emp_id, day_iso)
            dispatched += 1
        except Exception as e:  # noqa: BLE001
            print(f"[recompute] dispatch failed emp={emp_id} day={day_iso}: {e}", file=sys.stderr)

    print(f"[recompute] queued {dispatched} salary recomputes; watch celery_worker logs")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
