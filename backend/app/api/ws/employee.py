"""WS endpoint for the employee mobile app.

Phase 1 just authenticates and echoes a heartbeat. Phase 3 will start pushing
``salary_updated``, ``kpi_score_updated`` etc.
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect, status

from app.api.ws.connection import ws_manager
from app.core.security import ACCESS_TOKEN_TYPE, JWTError, decode_token

router = APIRouter()


def _decode_or_none(token: str) -> tuple[UUID, UUID | None] | None:
    try:
        payload = decode_token(token)
    except JWTError:
        return None
    if payload.get("type") != ACCESS_TOKEN_TYPE:
        return None
    sub = payload.get("sub")
    if not sub:
        return None
    try:
        user_id = UUID(sub)
        cid = payload.get("company_id")
        company_id = UUID(cid) if cid else None
    except (TypeError, ValueError):
        return None
    return user_id, company_id


@router.websocket("/ws/employee")
async def employee_ws(ws: WebSocket, token: str = Query(...)) -> None:
    decoded = _decode_or_none(token)
    if not decoded:
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    user_id, company_id = decoded

    await ws_manager.connect(ws, user_id=user_id, company_id=company_id)
    try:
        while True:
            msg = await ws.receive_json()
            # Phase 1: just echo heartbeats. Real handlers come in Phase 3.
            if msg.get("type") == "ping":
                await ws.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    finally:
        await ws_manager.disconnect(ws, user_id=user_id, company_id=company_id)
