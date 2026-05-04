"""WebSocket registry + Redis pub/sub fan-out.

Each API process keeps a local map (user_id → set[WebSocket]) and
(company_id → set[WebSocket]). When a Celery worker — or any other
process — publishes an event via ``ws_publisher.publish_event``, every
running API instance receives it on the ``wtp:ws`` Redis channel and
delivers it to the locally connected sockets.

This is the minimal contract that lets us scale the API tier horizontally
without the Celery worker needing direct WebSocket access.
"""
from __future__ import annotations

import asyncio
import json
import logging
from collections import defaultdict
from typing import Any
from uuid import UUID

import redis.asyncio as redis_async
from fastapi import WebSocket

from app.config import settings
from app.services.ws_publisher import WS_CHANNEL

logger = logging.getLogger(__name__)


class WSManager:
    def __init__(self) -> None:
        self._user_conns: dict[UUID, set[WebSocket]] = defaultdict(set)
        self._company_conns: dict[UUID, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()
        self._subscriber_task: asyncio.Task | None = None

    async def connect(self, ws: WebSocket, *, user_id: UUID, company_id: UUID | None) -> None:
        await ws.accept()
        async with self._lock:
            self._user_conns[user_id].add(ws)
            if company_id is not None:
                self._company_conns[company_id].add(ws)

    async def disconnect(self, ws: WebSocket, *, user_id: UUID, company_id: UUID | None) -> None:
        async with self._lock:
            self._user_conns.get(user_id, set()).discard(ws)
            if company_id is not None:
                self._company_conns.get(company_id, set()).discard(ws)

    async def _send_json(self, ws: WebSocket, payload: dict[str, Any]) -> None:
        try:
            await ws.send_json(payload)
        except Exception:  # noqa: BLE001
            # Drop broken sockets; the disconnect handler removes them.
            pass

    async def deliver(self, msg: dict[str, Any]) -> None:
        """Receive a pub/sub message and fan out to local sockets."""
        user_id_raw = msg.get("user_id")
        company_id_raw = msg.get("company_id")
        envelope = {"event": msg.get("event"), **(msg.get("payload") or {})}

        if user_id_raw:
            try:
                uid = UUID(user_id_raw)
            except ValueError:
                return
            for ws in list(self._user_conns.get(uid, set())):
                await self._send_json(ws, envelope)
            return

        if company_id_raw:
            try:
                cid = UUID(company_id_raw)
            except ValueError:
                return
            for ws in list(self._company_conns.get(cid, set())):
                await self._send_json(ws, envelope)

    async def start_subscriber(self) -> None:
        """Background task that listens on Redis and dispatches via deliver()."""
        if self._subscriber_task is not None:
            return
        self._subscriber_task = asyncio.create_task(self._subscriber_loop())

    async def stop_subscriber(self) -> None:
        if self._subscriber_task is None:
            return
        self._subscriber_task.cancel()
        try:
            await self._subscriber_task
        except (asyncio.CancelledError, Exception):
            pass
        self._subscriber_task = None

    async def _subscriber_loop(self) -> None:
        url = settings.redis_url or f"redis://{settings.redis_host}:{settings.redis_port}/{settings.redis_db}"
        client = redis_async.from_url(url)
        pubsub = client.pubsub()
        try:
            await pubsub.subscribe(WS_CHANNEL)
            async for message in pubsub.listen():
                if message.get("type") != "message":
                    continue
                data = message.get("data")
                if isinstance(data, (bytes, bytearray)):
                    data = data.decode("utf-8")
                try:
                    msg = json.loads(data)
                except (TypeError, json.JSONDecodeError):
                    continue
                await self.deliver(msg)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("WS subscriber loop crashed; reconnecting")
        finally:
            try:
                await pubsub.unsubscribe(WS_CHANNEL)
                await pubsub.close()
            finally:
                await client.aclose()


ws_manager = WSManager()


__all__ = ["WSManager", "ws_manager"]
