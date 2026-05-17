"""Celery tasks for Telegram fan-out.

A single task today: ``telegram.notify_subscribers`` — given a
``Notification`` id, look up every ``TelegramSubscriber`` in the same
company that has the notification's category enabled, and forward the
message via the company's bot.

Why fan-out lives in Celery (not in the request path):
  * Telegram's Bot API is rate-limited and occasionally slow.
  * A single anomaly notification might fan out to 5–10 subscribers
    (HR + branch managers + on-call); blocking the request that
    *created* the notification on five Telegram round-trips would
    noticeably slow the UI.
  * Failures (banned bot, dead chat_id) shouldn't fail the original
    request that created the underlying notification.

Errors are logged + recorded on the subscriber row (``last_error``)
so the admin UI can show a per-subscriber health column.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from html import escape
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import settings
from app.core.tenant import install_tenant_listener
from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)


def _make_engine():
    from sqlalchemy import NullPool

    return create_async_engine(settings.database_url_async, poolclass=NullPool)


_CATEGORY_EMOJI = {
    "SYSTEM": "🔔",
    "ATTENDANCE": "🕒",
    "SALARY": "💰",
    "KPI": "📊",
    "LEAVE": "🌴",
    "DEVICE": "🛠️",
    "ANOMALY": "⚠️",
}


def _format_message(category: str, title: str, body: str | None) -> str:
    """HTML-formatted message body. We use the HTML parse mode because
    it's simpler to escape than MarkdownV2 (which requires escaping a
    long list of characters), and the formatting we need is minimal:
    a bold title + plain body."""
    emoji = _CATEGORY_EMOJI.get(category, "🔔")
    safe_title = escape(title or "")
    parts = [f"{emoji} <b>{safe_title}</b>"]
    if body:
        parts.append(escape(body))
    return "\n\n".join(parts)


async def _dispatch(
    *,
    company_id: UUID,
    category: str,
    title: str,
    body: str | None,
) -> dict:
    """Shared core: look up the company bot + matching subscribers, send."""
    from app.models.telegram import TelegramSettings, TelegramSubscriber
    from app.services import telegram_service

    engine = _make_engine()
    Session = async_sessionmaker(bind=engine, expire_on_commit=False)
    try:
        async with Session() as db:
            install_tenant_listener()
            settings_row = (
                await db.execute(
                    select(TelegramSettings)
                    .where(TelegramSettings.company_id == company_id)
                    .execution_options(skip_tenant_filter=True)
                )
            ).scalar_one_or_none()
            if (
                settings_row is None
                or not settings_row.is_active
                or not settings_row.bot_token
            ):
                return {"status": "bot_disabled"}

            subs = (
                await db.execute(
                    select(TelegramSubscriber)
                    .where(
                        TelegramSubscriber.company_id == company_id,
                        TelegramSubscriber.is_active.is_(True),
                    )
                    .execution_options(skip_tenant_filter=True)
                )
            ).scalars().all()

            # SYSTEM always passes (rare + operationally important),
            # mirroring notification_service's mute logic.
            def _wants(sub: TelegramSubscriber) -> bool:
                if category == "SYSTEM":
                    return True
                cats = sub.enabled_categories or []
                return category in cats

            targets = [s for s in subs if _wants(s)]
            if not targets:
                return {"status": "no_subscribers", "total": len(subs)}

            text = _format_message(category, title, body)
            sent = 0
            failed = 0
            for sub in targets:
                try:
                    await telegram_service.send_message(
                        settings_row.bot_token, sub.chat_id, text
                    )
                    sub.last_sent_at = datetime.now(timezone.utc)
                    sub.last_error = None
                    sent += 1
                except telegram_service.TelegramAPIError as exc:
                    sub.last_error = str(exc)[:500]
                    failed += 1
                    logger.warning(
                        "telegram send failed sub=%s chat=%s: %s",
                        sub.id, sub.chat_id, exc,
                    )
            await db.commit()
            return {"status": "ok", "sent": sent, "failed": failed}
    finally:
        await engine.dispose()


async def _notify_async(notification_id: UUID) -> dict:
    from app.models.notification import Notification

    engine = _make_engine()
    Session = async_sessionmaker(bind=engine, expire_on_commit=False)
    try:
        async with Session() as db:
            install_tenant_listener()
            note = (
                await db.execute(
                    select(Notification)
                    .where(Notification.id == notification_id)
                    .execution_options(skip_tenant_filter=True)
                )
            ).scalar_one_or_none()
            if note is None:
                return {"status": "not_found"}
            if note.company_id is None:
                # Owner-scoped messages aren't routed through a per-company bot.
                return {"status": "no_company"}
            category_value = (
                note.category.value
                if hasattr(note.category, "value")
                else str(note.category)
            )
    finally:
        await engine.dispose()

    return await _dispatch(
        company_id=note.company_id,
        category=category_value,
        title=note.title,
        body=note.body,
    )


def _run_sync(coro) -> dict:
    """Run an async coroutine from a sync Celery worker thread."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            raise RuntimeError("loop already running")
        return loop.run_until_complete(coro)
    except RuntimeError:
        return asyncio.run(coro)


@celery_app.task(name="telegram.notify_subscribers", bind=True, max_retries=2)
def notify_subscribers(self, notification_id: str) -> dict:
    """Fan a single ``Notification`` row out to matching Telegram
    subscribers in the same company. Used by single-user ``notify()``
    calls; broadcasters use ``broadcast_company`` to avoid N×M sends."""
    try:
        return _run_sync(_notify_async(UUID(notification_id)))
    except Exception as exc:  # noqa: BLE001
        logger.exception("telegram.notify_subscribers failed")
        raise self.retry(exc=exc, countdown=30) from exc


@celery_app.task(name="telegram.broadcast_company", bind=True, max_retries=2)
def broadcast_company(
    self,
    company_id: str,
    category: str,
    title: str,
    body: str | None = None,
) -> dict:
    """Fan a single logical event out to every subscriber in a company.

    Used by ``notify_company_admins`` / ``notify_branch_managers`` so a
    notification that creates 5 in-app rows still triggers exactly one
    Telegram message per subscriber.
    """
    try:
        return _run_sync(
            _dispatch(
                company_id=UUID(company_id),
                category=category,
                title=title,
                body=body,
            )
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("telegram.broadcast_company failed")
        raise self.retry(exc=exc, countdown=30) from exc


__all__ = ["broadcast_company", "notify_subscribers"]
