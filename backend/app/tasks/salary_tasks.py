"""Celery tasks for salary recompute, daily summary, monthly finalize."""
from __future__ import annotations

import asyncio
import logging
from datetime import date as Date
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import settings
from app.core.tenant import install_tenant_listener
from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)


def _make_engine():
    """Each Celery worker gets its own async engine. NullPool avoids holding
    connections open across the worker's idle gaps."""
    from sqlalchemy import NullPool

    return create_async_engine(settings.database_url_async, poolclass=NullPool)


async def _recompute_async(employee_id: UUID, day: Date) -> dict:
    """Run the actual recompute + push WS notification."""
    from app.services import salary_service
    from app.services.ws_publisher import publish_salary_updated

    engine = _make_engine()
    Session = async_sessionmaker(bind=engine, expire_on_commit=False)
    try:
        async with Session() as db:
            install_tenant_listener()
            accrual = await salary_service.recompute_for_day(db, employee_id, day)
            employee_id_val = accrual.employee_id
            today_total = float(accrual.total_earned)

            # Pull the period total alongside.
            from app.models.employee import Employee
            from app.models.salary import SalaryPeriod

            employee = (
                await db.execute(
                    select(Employee)
                    .where(Employee.id == employee_id_val)
                    .execution_options(skip_tenant_filter=True)
                )
            ).scalar_one()
            period = (
                await db.execute(
                    select(SalaryPeriod).where(
                        SalaryPeriod.employee_id == employee_id_val,
                        SalaryPeriod.year == day.year,
                        SalaryPeriod.month == day.month,
                    )
                )
            ).scalar_one_or_none()
            period_total = float(period.total_earned) if period else 0.0
            await db.commit()

        await publish_salary_updated(
            user_id=employee.user_id,
            company_id=employee.company_id,
            today=today_total,
            month=period_total,
            day=day.isoformat(),
        )
        return {"employee_id": str(employee_id_val), "today": today_total, "month": period_total}
    finally:
        await engine.dispose()


@celery_app.task(name="salary.recompute_for_day", bind=True, max_retries=3, default_retry_delay=10)
def recompute_for_day(self, employee_id: str, day_iso: str) -> dict:
    """Public entrypoint. Called from the attendance check-out path."""
    try:
        return asyncio.run(_recompute_async(UUID(employee_id), Date.fromisoformat(day_iso)))
    except Exception as exc:  # noqa: BLE001
        logger.exception("salary.recompute_for_day failed for %s on %s", employee_id, day_iso)
        raise self.retry(exc=exc)


async def _daily_summary_async() -> int:
    """Per-active-employee daily recompute. Idempotent."""
    from app.models.employee import Employee
    from app.services import salary_service

    today = datetime.now(timezone.utc).date()
    engine = _make_engine()
    Session = async_sessionmaker(bind=engine, expire_on_commit=False)
    count = 0
    try:
        async with Session() as db:
            install_tenant_listener()
            employees = (
                await db.execute(
                    select(Employee.id)
                    .where(Employee.is_active.is_(True))
                    .execution_options(skip_tenant_filter=True)
                )
            ).scalars().all()
            for emp_id in employees:
                await salary_service.recompute_for_day(db, emp_id, today)
                count += 1
            await db.commit()
        return count
    finally:
        await engine.dispose()


@celery_app.task(name="salary.daily_summary")
def daily_summary() -> dict:
    n = asyncio.run(_daily_summary_async())
    return {"recomputed": n, "date": datetime.now(timezone.utc).date().isoformat()}


async def _monthly_finalize_async(year: int, month: int) -> int:
    """Move every DRAFT period for the given month to FINALIZED."""
    from app.models.salary import PeriodStatus, SalaryPeriod

    engine = _make_engine()
    Session = async_sessionmaker(bind=engine, expire_on_commit=False)
    try:
        async with Session() as db:
            install_tenant_listener()
            rows = (
                await db.execute(
                    select(SalaryPeriod)
                    .where(
                        SalaryPeriod.year == year,
                        SalaryPeriod.month == month,
                        SalaryPeriod.status == PeriodStatus.DRAFT.value,
                    )
                    .execution_options(skip_tenant_filter=True)
                )
            ).scalars().all()
            now = datetime.now(timezone.utc)
            for p in rows:
                p.status = PeriodStatus.FINALIZED
                p.finalized_at = now
            await db.commit()
            return len(rows)
    finally:
        await engine.dispose()


@celery_app.task(name="salary.monthly_finalize")
def monthly_finalize(year: int, month: int) -> dict:
    n = asyncio.run(_monthly_finalize_async(year, month))
    return {"finalized": n, "year": year, "month": month}


# ----------------------------------------------------------------------------
# Month-end close — recompute every employee for the full month, then auto-
# approve every DRAFT/FINALIZED period. Designed to fire on the last day of
# the month; safe to run multiple times (recompute is idempotent, approve is
# idempotent).
# ----------------------------------------------------------------------------


async def _month_end_close_async(year: int, month: int) -> dict:
    from sqlalchemy import distinct

    from app.models.employee import Employee
    from app.models.salary import PeriodStatus, SalaryPeriod
    from app.services import salary_service

    engine = _make_engine()
    Session = async_sessionmaker(bind=engine, expire_on_commit=False)
    totals = {"companies": 0, "employees": 0, "days": 0, "approved": 0}
    try:
        async with Session() as db:
            install_tenant_listener()
            company_ids = (
                await db.execute(
                    select(distinct(Employee.company_id))
                    .where(Employee.is_active.is_(True))
                    .execution_options(skip_tenant_filter=True)
                )
            ).scalars().all()
            for cid in company_ids:
                # Step 1 — fresh totals for every employee in the company.
                rec = await salary_service.recompute_company_month(
                    db, cid, year, month
                )
                totals["employees"] += rec["employees"]
                totals["days"] += rec["days"]
                # Step 2 — auto-approve every DRAFT/FINALIZED period.
                approved = await salary_service.bulk_approve_company(
                    db, cid, year, month, actor_id=None
                )
                totals["approved"] += approved
                totals["companies"] += 1
            await db.commit()
        return totals
    finally:
        await engine.dispose()


@celery_app.task(name="salary.month_end_close")
def month_end_close(year: int | None = None, month: int | None = None) -> dict:
    """Run on the last day of the month at ~23:50.

    1. Recompute every active employee's full month.
    2. Auto-approve every DRAFT/FINALIZED period.

    Does NOT auto-pay — payment stays as an explicit admin action.
    """
    today = datetime.now(timezone.utc).date()
    y = year or today.year
    m = month or today.month
    res = asyncio.run(_month_end_close_async(y, m))
    logger.info("salary.month_end_close y=%s m=%s res=%s", y, m, res)
    return {"year": y, "month": m, **res}
