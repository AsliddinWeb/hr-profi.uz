"""Web Push delivery via VAPID.

Best-effort wrapper around ``pywebpush``. Failures (expired subscriptions,
network errors) are logged and the offending subscription is auto-pruned so
the table doesn't fill with dead endpoints.
"""
from __future__ import annotations

import json
import logging
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.push_subscription import WebPushSubscription

logger = logging.getLogger(__name__)


def _has_vapid() -> bool:
    return bool(settings.vapid_private_key and settings.vapid_public_key)


async def send_to_user(
    db: AsyncSession,
    *,
    user_id: UUID,
    title: str,
    body: str | None = None,
    payload: dict[str, Any] | None = None,
) -> int:
    """Send a push to every subscription a user has registered.

    Returns the count of pushes accepted by the upstream gateway. Dead
    subscriptions (HTTP 404/410) are deleted from the DB.
    """
    if not _has_vapid():
        return 0

    try:
        from pywebpush import WebPushException, webpush  # type: ignore[import-untyped]
    except ImportError:
        logger.warning("pywebpush not installed; skipping push")
        return 0

    subs = (
        await db.execute(
            select(WebPushSubscription).where(WebPushSubscription.user_id == user_id)
        )
    ).scalars().all()

    body_json = json.dumps(
        {
            "title": title,
            "body": body or "",
            "data": payload or {},
        }
    )

    sent = 0
    dead: list[WebPushSubscription] = []
    for sub in subs:
        try:
            webpush(
                subscription_info={
                    "endpoint": sub.endpoint,
                    "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
                },
                data=body_json,
                vapid_private_key=settings.vapid_private_key,
                vapid_claims={"sub": settings.vapid_subject},
                ttl=60 * 60 * 24,
            )
            sent += 1
        except WebPushException as ex:
            status = getattr(ex.response, "status_code", None) if ex.response else None
            if status in (404, 410):
                dead.append(sub)
            else:
                logger.warning("webpush failed user=%s status=%s: %s", user_id, status, ex)
        except Exception:  # noqa: BLE001
            logger.exception("webpush unexpected error user=%s", user_id)

    if dead:
        for sub in dead:
            await db.delete(sub)
        await db.commit()

    return sent


__all__ = ["send_to_user"]
