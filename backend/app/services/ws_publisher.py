"""Real-time event publishing.

Phase 3 design:
- Workers (api, celery) publish events to Redis pub/sub on channel ``wtp:ws``.
- Each api instance subscribes once at startup and fans out to its locally
  connected WebSockets via ``ws_manager``.

That keeps the Celery worker → mobile delivery loop simple even when there
are multiple api containers.
"""
from __future__ import annotations

import json
import logging
from typing import Any
from uuid import UUID

import redis.asyncio as redis_async

from app.config import settings

logger = logging.getLogger(__name__)

WS_CHANNEL = "wtp:ws"


def _serialize(payload: dict[str, Any]) -> str:
    def default(o: Any) -> Any:
        if isinstance(o, UUID):
            return str(o)
        return str(o)

    return json.dumps(payload, default=default)


async def publish_event(
    *,
    event: str,
    user_id: UUID | None = None,
    company_id: UUID | None = None,
    payload: dict[str, Any] | None = None,
) -> None:
    """Send an event to subscribers. ``user_id`` targets one user (mobile);
    ``company_id`` targets the admin panel for that tenant."""
    msg = {
        "event": event,
        "user_id": str(user_id) if user_id else None,
        "company_id": str(company_id) if company_id else None,
        "payload": payload or {},
    }
    client = redis_async.from_url(settings.redis_url or f"redis://{settings.redis_host}:{settings.redis_port}/{settings.redis_db}")
    try:
        await client.publish(WS_CHANNEL, _serialize(msg))
    except Exception:  # noqa: BLE001
        # WS push failures must not fail the API request.
        logger.exception("WS publish failed for event=%s", event)
    finally:
        await client.aclose()


# ---------- Convenience wrappers ----------


async def publish_salary_updated(
    *,
    user_id: UUID | None,
    company_id: UUID,
    today: float,
    month: float,
    day: str,
) -> None:
    await publish_event(
        event="salary_updated",
        user_id=user_id,
        company_id=company_id,
        payload={"today": today, "month": month, "date": day},
    )


async def publish_kpi_score_updated(
    *,
    user_id: UUID | None,
    company_id: UUID,
    template_id: UUID,
    score: float,
    reward: float,
) -> None:
    await publish_event(
        event="kpi_score_updated",
        user_id=user_id,
        company_id=company_id,
        payload={
            "template_id": str(template_id),
            "score": score,
            "reward": reward,
        },
    )


async def publish_leave_status_changed(
    *,
    user_id: UUID | None,
    company_id: UUID,
    request_id: UUID,
    status: str,
) -> None:
    await publish_event(
        event="leave_status_changed",
        user_id=user_id,
        company_id=company_id,
        payload={"request_id": str(request_id), "status": status},
    )


__all__ = [
    "WS_CHANNEL",
    "publish_event",
    "publish_kpi_score_updated",
    "publish_leave_status_changed",
    "publish_salary_updated",
]
