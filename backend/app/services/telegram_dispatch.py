"""Event-level Telegram dispatch.

The notification_service hook fans every ``Notification`` row out to
Telegram subscribers automatically — that path is for events the admin
also wants to see in the in-app bell (anomalies, leave decisions,
device-offline, etc.).

This module is the *other* path: high-volume operational events that
the admin only wants in Telegram (every check-in, every check-out,
every late arrival) without spamming the in-app bell. Each event is
gated by a per-company ``TelegramSettings.event_filters`` toggle and
flows directly to the ``telegram.broadcast_company`` Celery task — no
Notification row created.

The registry below is the source of truth for which events exist; the
admin UI reads it to render the toggle list.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import NotificationCategory
from app.models.telegram import TelegramSettings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class TelegramEvent:
    """One forwardable event type.

    ``key`` is the stable JSON key written into
    ``TelegramSettings.event_filters`` — never rename, even if the
    label changes.
    """

    key: str
    category: NotificationCategory  # subscriber-side opt-in still applies
    default: bool = False


# ---- Registry ---------------------------------------------------------------
#
# Every event the admin can toggle in the UI. Keys are stable string IDs
# stored in the JSON column; the category is what each subscriber must have
# opted into for the message to land.

TELEGRAM_EVENTS: tuple[TelegramEvent, ...] = (
    # Attendance — high volume; off by default for the routine events,
    # on by default for the ones that hint at trouble (late / early /
    # face mismatch).
    TelegramEvent("check_in",           NotificationCategory.ATTENDANCE),
    TelegramEvent("check_out",          NotificationCategory.ATTENDANCE),
    TelegramEvent("late_check_in",      NotificationCategory.ATTENDANCE, default=True),
    TelegramEvent("early_check_out",    NotificationCategory.ATTENDANCE, default=True),
    # Face mismatch is otherwise silent (the check-in is rejected with
    # a ConflictError, no in-app Notification row is created), so we
    # specifically forward it to Telegram when the toggle is on.
    TelegramEvent("face_mismatch",      NotificationCategory.ANOMALY, default=True),
    # Note: out-of-geofence, device offline/online and leave events
    # are NOT listed here — they already flow through
    # ``notification_service.notify_company_admins`` which fans out to
    # Telegram subscribers (gated by their per-category opt-in). Adding
    # them here would double-send.
)

_BY_KEY: dict[str, TelegramEvent] = {e.key: e for e in TELEGRAM_EVENTS}


def default_event_filters() -> dict[str, bool]:
    """Return the default ``event_filters`` dict for a fresh tenant.

    Includes only the events flagged ``default=True`` so an admin who
    pastes their token gets sensible alerts (anomalies + device offline
    + leave requests) without immediately being flooded by every
    routine check-in.
    """
    return {e.key: True for e in TELEGRAM_EVENTS if e.default}


def normalize_event_filters(
    raw: dict[str, Any] | None,
) -> dict[str, bool]:
    """Coerce a JSON blob from the DB into a clean ``{key: bool}``.

    Unknown keys are dropped (forward-compat: don't crash if an old
    row has a renamed key); non-bool values coerce to bool.
    """
    if not raw:
        return {}
    out: dict[str, bool] = {}
    for k, v in raw.items():
        if k in _BY_KEY:
            out[k] = bool(v)
    return out


def merge_event_filters(
    current: dict[str, Any] | None,
    updates: dict[str, bool],
) -> dict[str, bool]:
    """Apply a partial update without losing keys the caller didn't send."""
    out = normalize_event_filters(current)
    for k, v in updates.items():
        if k in _BY_KEY:
            out[k] = bool(v)
    return out


async def telegram_event(
    db: AsyncSession,
    *,
    company_id: UUID,
    event_key: str,
    title: str,
    body: str | None = None,
) -> bool:
    """Dispatch one operational event to Telegram subscribers.

    Returns True if the event was enqueued, False if it was filtered
    out (event toggled off, bot not configured, or unknown event key).
    Never raises — Telegram is a best-effort side channel and must not
    fail the underlying business operation.
    """
    event = _BY_KEY.get(event_key)
    if event is None:
        logger.warning("telegram_event: unknown event_key=%s", event_key)
        return False

    try:
        row = (
            await db.execute(
                select(TelegramSettings)
                .where(TelegramSettings.company_id == company_id)
                .execution_options(skip_tenant_filter=True)
            )
        ).scalar_one_or_none()
    except Exception:  # noqa: BLE001
        logger.exception(
            "telegram_event: settings lookup failed company=%s", company_id
        )
        return False

    if row is None or not row.is_active or not row.bot_token:
        return False
    filters = normalize_event_filters(row.event_filters)
    if not filters.get(event.key):
        return False

    try:
        from app.tasks.telegram_tasks import broadcast_company

        broadcast_company.delay(
            str(company_id), event.category.value, title, body
        )
    except Exception:  # noqa: BLE001
        logger.exception(
            "telegram_event: enqueue failed company=%s event=%s",
            company_id, event_key,
        )
        return False
    return True


__all__ = [
    "TELEGRAM_EVENTS",
    "TelegramEvent",
    "default_event_filters",
    "merge_event_filters",
    "normalize_event_filters",
    "telegram_event",
]
