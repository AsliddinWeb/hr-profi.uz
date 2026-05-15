"""Wipe auto-generated bonuses + deductions for a company.

Recent salary recomputes (after the timezone fix + hire_date guard
deployments) re-derived ``Bonus`` / ``Deduction`` rows with
``auto_generated=True``. If a company was running on the *old*
values — payroll already approved, employees already informed —
those auto-rewrites can show up as unwelcome surprise changes.

This script gives the operator a precise, reversible "back to manual"
button:

    docker compose ... exec api \\
      python -m scripts.wipe_auto_bonuses_deductions \\
        --company-id <UUID> \\
        [--month YYYY-MM]           # default = current month
        [--all-months]              # ignore --month, wipe entire history
        [--bonuses-only]            # leave deductions alone
        [--deductions-only]         # leave bonuses alone
        [--no-recompute]            # skip the salary recompute pass
        [--dry-run]                 # report counts but write nothing

Manual entries (auto_generated=False) are never touched.

After the rows are removed, the script re-fires
``salary.recompute_for_day`` on every affected (employee, day) so the
``SalaryDailyAccrual.total_earned`` totals refresh. If you also want
the auto-generators to stop *creating* fresh rows on the next
recompute, set ``late_penalty_per_min = 0`` and
``absence_penalty_enabled = false`` in the company's settings JSON
(via /owner/companies/{id} PATCH).
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import date as Date
from datetime import datetime
from uuid import UUID

from sqlalchemy import and_, distinct, select

from app.database import AsyncSessionLocal
from app.models.bonus_deduction import Bonus, Deduction


def _month_range(year: int, month: int) -> tuple[Date, Date]:
    """Inclusive start, exclusive end of the calendar month."""
    start = Date(year, month, 1)
    if month == 12:
        end = Date(year + 1, 1, 1)
    else:
        end = Date(year, month + 1, 1)
    return start, end


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--company-id", required=True, help="Company UUID to operate on."
    )
    parser.add_argument(
        "--month",
        help="YYYY-MM. Defaults to the current calendar month.",
    )
    parser.add_argument(
        "--all-months",
        action="store_true",
        help="Wipe across all months instead of a single one.",
    )
    parser.add_argument(
        "--bonuses-only",
        action="store_true",
        help="Only delete auto-generated Bonus rows.",
    )
    parser.add_argument(
        "--deductions-only",
        action="store_true",
        help="Only delete auto-generated Deduction rows.",
    )
    parser.add_argument(
        "--no-recompute",
        action="store_true",
        help="Skip salary recompute after deletion.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report counts but make no changes.",
    )
    args = parser.parse_args()

    try:
        company_id = UUID(args.company_id)
    except ValueError:
        print(f"[wipe] invalid --company-id: {args.company_id}", file=sys.stderr)
        return 1

    if args.bonuses_only and args.deductions_only:
        print(
            "[wipe] pass at most one of --bonuses-only / --deductions-only",
            file=sys.stderr,
        )
        return 1

    if args.all_months:
        date_filter = None
        scope_label = "ALL MONTHS"
    else:
        if args.month:
            try:
                y, m = args.month.split("-")
                start, end = _month_range(int(y), int(m))
            except (ValueError, IndexError):
                print(f"[wipe] invalid --month: {args.month}", file=sys.stderr)
                return 1
            scope_label = f"{args.month}"
        else:
            now = datetime.now()
            start, end = _month_range(now.year, now.month)
            scope_label = f"{now.year}-{now.month:02d} (current)"
        date_filter = (start, end)

    bonuses_targeted = not args.deductions_only
    deductions_targeted = not args.bonuses_only

    async with AsyncSessionLocal() as db:
        # Gather affected (employee_id, applied_date) pairs first so we
        # can re-fire recompute after the deletes land.
        affected_pairs: set[tuple[UUID, Date]] = set()

        if bonuses_targeted:
            stmt = (
                select(distinct(Bonus.employee_id), Bonus.applied_date)
                .where(
                    and_(
                        Bonus.company_id == company_id,
                        Bonus.auto_generated.is_(True),
                    )
                )
                .execution_options(skip_tenant_filter=True)
            )
            if date_filter:
                stmt = stmt.where(
                    Bonus.applied_date >= date_filter[0],
                    Bonus.applied_date < date_filter[1],
                )
            for emp_id, day in (await db.execute(stmt)).all():
                affected_pairs.add((emp_id, day))

        if deductions_targeted:
            stmt = (
                select(distinct(Deduction.employee_id), Deduction.applied_date)
                .where(
                    and_(
                        Deduction.company_id == company_id,
                        Deduction.auto_generated.is_(True),
                    )
                )
                .execution_options(skip_tenant_filter=True)
            )
            if date_filter:
                stmt = stmt.where(
                    Deduction.applied_date >= date_filter[0],
                    Deduction.applied_date < date_filter[1],
                )
            for emp_id, day in (await db.execute(stmt)).all():
                affected_pairs.add((emp_id, day))

        # Count rows for reporting (cheap query, gives us a real preview
        # in --dry-run mode).
        bonus_count = 0
        deduction_count = 0
        if bonuses_targeted:
            from sqlalchemy import func

            stmt = select(func.count(Bonus.id)).where(
                Bonus.company_id == company_id,
                Bonus.auto_generated.is_(True),
            )
            if date_filter:
                stmt = stmt.where(
                    Bonus.applied_date >= date_filter[0],
                    Bonus.applied_date < date_filter[1],
                )
            bonus_count = (
                await db.execute(stmt.execution_options(skip_tenant_filter=True))
            ).scalar_one()
        if deductions_targeted:
            from sqlalchemy import func

            stmt = select(func.count(Deduction.id)).where(
                Deduction.company_id == company_id,
                Deduction.auto_generated.is_(True),
            )
            if date_filter:
                stmt = stmt.where(
                    Deduction.applied_date >= date_filter[0],
                    Deduction.applied_date < date_filter[1],
                )
            deduction_count = (
                await db.execute(stmt.execution_options(skip_tenant_filter=True))
            ).scalar_one()

        print(
            f"[wipe] scope={scope_label}  company={company_id}  "
            f"bonuses={bonus_count}  deductions={deduction_count}  "
            f"affected_employee_days={len(affected_pairs)}  "
            f"dry_run={args.dry_run}"
        )

        if args.dry_run or (bonus_count == 0 and deduction_count == 0):
            return 0

        # Execute the deletes.
        if bonuses_targeted and bonus_count > 0:
            del_stmt = Bonus.__table__.delete().where(
                Bonus.company_id == company_id,
                Bonus.auto_generated.is_(True),
            )
            if date_filter:
                del_stmt = del_stmt.where(
                    Bonus.applied_date >= date_filter[0],
                    Bonus.applied_date < date_filter[1],
                )
            await db.execute(del_stmt)

        if deductions_targeted and deduction_count > 0:
            del_stmt = Deduction.__table__.delete().where(
                Deduction.company_id == company_id,
                Deduction.auto_generated.is_(True),
            )
            if date_filter:
                del_stmt = del_stmt.where(
                    Deduction.applied_date >= date_filter[0],
                    Deduction.applied_date < date_filter[1],
                )
            await db.execute(del_stmt)

        await db.commit()
        print(f"[wipe] deleted bonuses={bonus_count}, deductions={deduction_count}")

    if args.no_recompute or not affected_pairs:
        return 0

    # Re-fire salary recompute so SalaryDailyAccrual totals refresh
    # without the deleted rows. Lazy import keeps the broker dependency
    # out of the delete path.
    try:
        from app.tasks.salary_tasks import recompute_for_day
    except Exception as e:  # noqa: BLE001
        print(f"[wipe] recompute import failed: {e}", file=sys.stderr)
        return 0

    dispatched = 0
    for emp_id, day in affected_pairs:
        try:
            recompute_for_day.delay(str(emp_id), day.isoformat())
            dispatched += 1
        except Exception as e:  # noqa: BLE001
            print(
                f"[wipe] dispatch failed emp={emp_id} day={day}: {e}",
                file=sys.stderr,
            )

    print(
        f"[wipe] queued {dispatched} salary recomputes — watch the celery_worker logs"
    )
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
