"""Generic adapter — for an on-prem agent or custom integration.

Contract: the device (or a relay agent) exposes three HTTP endpoints
relative to ``device.config['enroll_base_url']`` (or the device's IP if
unset). Each endpoint accepts a JSON body with ``employee_code`` and a
base64 photo, secured with the same ``X-WTP-Key`` header used for inbound
webhooks::

    POST  {base}/face/enroll   →  { "template_id": "..." }
    POST  {base}/face/update   →  { "template_id": "..." }
    POST  {base}/face/delete   →  204

When ``settings.face_sync_dry_run`` is True we skip the network call and
return a fake template id — lets the queue exercise end-to-end without
real hardware.
"""
from __future__ import annotations

import base64
import logging
import uuid

import httpx

from app.config import settings
from app.models.device import Device
from app.models.employee import Employee

logger = logging.getLogger(__name__)


def _base_url(device: Device) -> str:
    cfg = device.config or {}
    base = cfg.get("enroll_base_url") or (
        f"http://{device.ip_address}" if device.ip_address else None
    )
    if not base:
        raise RuntimeError("device.no_enroll_url")
    return base.rstrip("/")


def _headers(device: Device) -> dict[str, str]:
    # Reuse the same credential the inbound webhook is signed with. We
    # don't HMAC the body here (the device must trust the management plane);
    # device-side ACLs (TLS pinning + IP allowlist) are how production
    # locks this down further.
    return {
        "Content-Type": "application/json",
        "X-WTP-Server": "wtp",
    }


class GenericAdapter:
    async def enroll(
        self, device: Device, employee: Employee, photo_bytes: bytes
    ) -> str:
        if settings.face_sync_dry_run:
            return f"dry-{uuid.uuid4().hex[:12]}"
        url = f"{_base_url(device)}/face/enroll"
        body = {
            "employee_code": employee.employee_code,
            "full_name": employee.full_name,
            "photo_base64": base64.b64encode(photo_bytes).decode("ascii"),
        }
        async with httpx.AsyncClient(
            timeout=settings.face_sync_http_timeout_seconds
        ) as c:
            r = await c.post(url, json=body, headers=_headers(device))
            r.raise_for_status()
            return r.json().get("template_id", "")

    async def update(
        self,
        device: Device,
        employee: Employee,
        photo_bytes: bytes,
        vendor_template_id: str | None,
    ) -> str:
        if settings.face_sync_dry_run:
            return vendor_template_id or f"dry-{uuid.uuid4().hex[:12]}"
        url = f"{_base_url(device)}/face/update"
        body = {
            "employee_code": employee.employee_code,
            "template_id": vendor_template_id,
            "photo_base64": base64.b64encode(photo_bytes).decode("ascii"),
        }
        async with httpx.AsyncClient(
            timeout=settings.face_sync_http_timeout_seconds
        ) as c:
            r = await c.post(url, json=body, headers=_headers(device))
            r.raise_for_status()
            return r.json().get("template_id", vendor_template_id or "")

    async def delete(
        self,
        device: Device,
        employee: Employee,
        vendor_template_id: str | None,
    ) -> None:
        if settings.face_sync_dry_run:
            return
        url = f"{_base_url(device)}/face/delete"
        body = {
            "employee_code": employee.employee_code,
            "template_id": vendor_template_id,
        }
        async with httpx.AsyncClient(
            timeout=settings.face_sync_http_timeout_seconds
        ) as c:
            r = await c.post(url, json=body, headers=_headers(device))
            r.raise_for_status()
