"""Fire ``salary.recompute_for_day`` for every (active-employee, day) in
a company for a given month.

Used when ``SalaryDailyAccrual`` totals need refreshing but the wipe
script didn't have any rows to delete (so it skipped its own
recompute fan-out). Example workflow:

    1. Wipe auto bonuses/deductions
    2. Update company.settings to disable auto-deductions
    3. Run this script to refresh totals → admin sees the new values

Usage (inside the api container):

    docker compose ... exec api \\
      python -m scripts.recompute_company_salary \\
        --company-id <UUID> \\
        [--month YYYY-MM]   # default = current month
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import date as Date
from datetime import datetime
from uuid import UUID

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.employee import Employee


def _month_range(year: int, month: int) -> tuple[Date, Date]:
    start = Date(year, month, 1)
    if month == 12:
        end = Date(year + 1, 1, 1)
    else:
        end = Date(year, month + 1, 1)
    return start, end


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--company-id", required=True)
    parser.add_argument("--month", help="YYYY-MM; defaults to current month")
    args = parser.parse_args()

    try:
        company_id = UUID(args.company_id)
    except ValueError:
        print(f"[recompute] bad --company-id", file=sys.stderr)
        return 1

    if args.month:
        try:
            y, m = args.month.split("-")
            start, end = _month_range(int(y), int(m))
        except (ValueError, IndexError):
            print(f"[recompute] bad --month", file=sys.stderr)
            return 1
    else:
        now = datetime.now()
        start, end = _month_range(now.year, now.month)

    async with AsyncSessionLocal() as db:
        stmt = (
            select(Employee.id)
            .where(
                Employee.company_id == company_id,
                Employee.is_active.is_(True),
            )
            .execution_options(skip_tenant_filter=True)
        )
        emp_ids = (await db.execute(stmt)).scalars().all()

    if not emp_ids:
        print(f"[recompute] no active employees for company {company_id}")
        return 0

    # Walk the month day-by-day.
    days: list[Date] = []
    cur = start
    while cur < end:
        days.append(cur)
        cur = Date.fromordinal(cur.toordinal() + 1)

    print(
        f"[recompute] firing salary recompute "
        f"for {len(emp_ids)} employees × {len(days)} days = "
        f"{len(emp_ids) * len(days)} tasks"
    )

    try:
        from app.tasks.salary_tasks import recompute_for_day
    except Exception as e:  # noqa: BLE001
        print(f"[recompute] import failed: {e}", file=sys.stderr)
        return 1

    dispatched = 0
    for emp_id in emp_ids:
        for day in days:
            try:
                recompute_for_day.delay(str(emp_id), day.isoformat())
                dispatched += 1
            except Exception as e:  # noqa: BLE001
                print(
                    f"[recompute] dispatch failed emp={emp_id} day={day}: {e}",
                    file=sys.stderr,
                )

    print(
        f"[recompute] queued {dispatched} tasks; "
        f"watch ``docker compose ... logs -f celery_worker`` for progress"
    )
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
