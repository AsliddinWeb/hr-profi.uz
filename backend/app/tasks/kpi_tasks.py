"""Celery tasks for the KPI engine.

* ``kpi.compute_scores``        — daily, recompute every active assignment.
* ``kpi.month_end_finalize``    — last day of month at 23:30, mark COMPUTED
                                  assignments as eligible for approval and
                                  emit a notification per company.
* ``kpi.recompute_period``      — ad-hoc, callable from the admin UI.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import distinct, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import settings
from app.core.tenant import install_tenant_listener
from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)


def _make_engine():
    from sqlalchemy import NullPool

    return create_async_engine(settings.database_url_async, poolclass=NullPool)


async def _recompute_async(
    year: int, month: int, company_id: UUID | None = None
) -> dict[str, int]:
    from app.models.kpi import KPIAssignment
    from app.services import kpi_service

    engine = _make_engine()
    Session = async_sessionmaker(bind=engine, expire_on_commit=False)
    install_tenant_listener()

    totals = {"recomputed": 0, "failed": 0, "companies": 0}
    try:
        async with Session() as db:
            if company_id:
                company_ids = [company_id]
            else:
                company_ids = (
                    await db.execute(
                        select(distinct(KPIAssignment.company_id))
                        .where(
                            KPIAssignment.year == year,
                            KPIAssignment.month == month,
                        )
                        .execution_options(skip_tenant_filter=True)
                    )
                ).scalars().all()
            for cid in company_ids:
                res = await kpi_service.recompute_company_assignments(
                    db, cid, year, month
                )
                totals["recomputed"] += res["recomputed"]
                totals["failed"] += res["failed"]
                totals["companies"] += 1
            await db.commit()
        return totals
    finally:
        await engine.dispose()


@celery_app.task(name="kpi.compute_scores")
def compute_scores(year: int | None = None, month: int | None = None) -> dict:
    """Recompute every active KPIAssignment for the given month across all
    companies. KPI bonuses are written as Bonus rows so the next salary
    recompute picks them up.

    Defaults to (now.year, now.month). Schedule via celery beat.
    """
    now = datetime.now(timezone.utc)
    y, m = year or now.year, month or now.month
    totals = asyncio.run(_recompute_async(y, m))
    logger.info("kpi.compute_scores y=%s m=%s totals=%s", y, m, totals)
    return {"year": y, "month": m, **totals}


async def _finalize_month_end_async(year: int, month: int) -> dict[str, int]:
    """Move ACTIVE assignments to COMPUTED at month-end so the approval
    workflow has clean inputs."""
    from app.models.kpi import KPIAssignment, KPIAssignmentStatus

    engine = _make_engine()
    Session = async_sessionmaker(bind=engine, expire_on_commit=False)
    install_tenant_listener()
    moved = 0
    try:
        async with Session() as db:
            rows = (
                await db.execute(
                    select(KPIAssignment)
                    .where(
                        KPIAssignment.year == year,
                        KPIAssignment.month == month,
                        KPIAssignment.status == KPIAssignmentStatus.ACTIVE.value,
                    )
                    .execution_options(skip_tenant_filter=True)
                )
            ).scalars().all()
            for a in rows:
                a.status = KPIAssignmentStatus.COMPUTED.value
                moved += 1
            await db.commit()
        return {"finalized": moved}
    finally:
        await engine.dispose()


@celery_app.task(name="kpi.month_end_finalize")
def month_end_finalize() -> dict:
    """Last day of the month: move ACTIVE → COMPUTED. The recompute task at
    00:30 next morning will fill in fresh scores."""
    today = date.today()
    # Run for the month that's ending today (today is its last day).
    res = asyncio.run(_finalize_month_end_async(today.year, today.month))
    logger.info("kpi.month_end_finalize y=%s m=%s res=%s", today.year, today.month, res)
    return {"year": today.year, "month": today.month, **res}


@celery_app.task(name="kpi.recompute_period")
def recompute_period(year: int, month: int, company_id: str | None = None) -> dict:
    cid = UUID(company_id) if company_id else None
    totals = asyncio.run(_recompute_async(year, month, cid))
    return {"year": year, "month": month, **totals}


__all__ = [
    "compute_scores",
    "month_end_finalize",
    "recompute_period",
]
