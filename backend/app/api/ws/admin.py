"""WS endpoint for admin panels.

Phase 1: stub. Phase 3+ pushes ``employee_checked_in``, ``device_offline``,
``anomaly_detected``.
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect, status

from app.api.ws.connection import ws_manager
from app.core.security import ACCESS_TOKEN_TYPE, JWTError, decode_token

router = APIRouter()


@router.websocket("/ws/admin")
async def admin_ws(ws: WebSocket, token: str = Query(...)) -> None:
    try:
        payload = decode_token(token)
    except JWTError:
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    if payload.get("type") != ACCESS_TOKEN_TYPE:
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    sub = payload.get("sub")
    cid = payload.get("company_id")
    role = payload.get("role")
    if not sub or role not in ("OWNER", "COMPANY_ADMIN", "HR_MANAGER", "BRANCH_MANAGER"):
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    user_id = UUID(sub)
    company_id = UUID(cid) if cid else None

    await ws_manager.connect(ws, user_id=user_id, company_id=company_id)
    try:
        while True:
            msg = await ws.receive_json()
            if msg.get("type") == "ping":
                await ws.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    finally:
        await ws_manager.disconnect(ws, user_id=user_id, company_id=company_id)
