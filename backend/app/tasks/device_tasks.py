"""Celery tasks for device fleet maintenance."""
from __future__ import annotations

import asyncio
import logging

from sqlalchemy import NullPool
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import settings
from app.core.tenant import install_tenant_listener
from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)


def _make_engine():
    return create_async_engine(settings.database_url_async, poolclass=NullPool)


async def _sweep_async() -> int:
    from app.services import device_service

    engine = _make_engine()
    Session = async_sessionmaker(bind=engine, expire_on_commit=False)
    try:
        async with Session() as db:
            install_tenant_listener()
            return await device_service.sweep_offline_devices(db)
    finally:
        await engine.dispose()


@celery_app.task(name="device.sweep_offline")
def sweep_offline() -> dict:
    n = asyncio.run(_sweep_async())
    return {"marked_offline": n}


async def _process_face_sync_async(limit: int = 50) -> dict:
    from app.services import face_sync_service

    engine = _make_engine()
    Session = async_sessionmaker(bind=engine, expire_on_commit=False)
    try:
        async with Session() as db:
            install_tenant_listener()
            return await face_sync_service.process_pending(db, limit=limit)
    finally:
        await engine.dispose()


@celery_app.task(name="device.process_face_sync")
def process_face_sync(limit: int = 50) -> dict:
    """Drain the face-template sync queue.

    Scheduled every 30 seconds so PENDING/RETRY rows whose ``next_retry_at``
    has elapsed get worked through quickly. Per-row HTTP timeout is bounded
    by ``settings.face_sync_http_timeout_seconds`` — a wedged device can't
    stall the rest of the batch.
    """
    return asyncio.run(_process_face_sync_async(limit))
