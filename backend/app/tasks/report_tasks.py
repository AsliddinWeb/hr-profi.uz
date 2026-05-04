"""Celery task: render a queued ReportJob to MinIO."""
from __future__ import annotations

import asyncio
import logging
from uuid import UUID

from sqlalchemy import NullPool
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import settings
from app.core.tenant import install_tenant_listener
from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)


def _make_engine():
    return create_async_engine(settings.database_url_async, poolclass=NullPool)


async def _run_async(job_id: UUID) -> dict:
    from app.services import report_service

    engine = _make_engine()
    Session = async_sessionmaker(bind=engine, expire_on_commit=False)
    try:
        async with Session() as db:
            install_tenant_listener()
            job = await report_service.run_job(db, job_id)
            await db.commit()
            return {
                "id": str(job.id),
                "status": (
                    job.status.value if hasattr(job.status, "value") else str(job.status)
                ),
                "row_count": job.row_count,
            }
    finally:
        await engine.dispose()


@celery_app.task(name="report.run", bind=True, max_retries=3, default_retry_delay=10)
def run_report_job(self, job_id: str) -> dict:
    try:
        return asyncio.run(_run_async(UUID(job_id)))
    except Exception as exc:  # noqa: BLE001
        logger.exception("report.run failed for %s", job_id)
        raise self.retry(exc=exc)
