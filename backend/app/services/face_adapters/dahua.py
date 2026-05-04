"""Dahua face-template adapter (Smart Profile API).

Endpoints (Digest auth, admin credentials in ``device.config``)::

  POST  /cgi-bin/AccessUser.cgi?action=insertMulti
        body: { "UserList": [ { "UserID": ..., "UserName": ..., ... } ] }

  POST  /cgi-bin/AccessFace.cgi?action=insertMulti
        body: { "FaceList": [ { "UserID": ..., "PhotoData": [base64] } ] }

  DELETE /cgi-bin/AccessUser.cgi?action=remove&UserID=...

Dahua identifies templates via ``UserID`` (we map to ``employee_code``).
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


def _base(device: Device) -> str:
    if not device.ip_address:
        raise RuntimeError("device.no_ip_address")
    return f"http://{device.ip_address}"


def _auth(device: Device) -> httpx.DigestAuth | None:
    cfg = device.config or {}
    user = cfg.get("admin_user")
    pw = cfg.get("admin_password")
    if user and pw:
        return httpx.DigestAuth(user, pw)
    return None


class DahuaAdapter:
    async def enroll(
        self, device: Device, employee: Employee, photo_bytes: bytes
    ) -> str:
        if settings.face_sync_dry_run:
            return f"dah-{uuid.uuid4().hex[:10]}"
        url_user = (
            f"{_base(device)}/cgi-bin/AccessUser.cgi?action=insertMulti"
        )
        body_user = {
            "UserList": [
                {
                    "UserID": employee.employee_code,
                    "UserName": employee.full_name or employee.employee_code,
                    "UserType": 0,
                    "Authority": 2,
                }
            ]
        }
        url_face = (
            f"{_base(device)}/cgi-bin/AccessFace.cgi?action=insertMulti"
        )
        body_face = {
            "FaceList": [
                {
                    "UserID": employee.employee_code,
                    "PhotoData": [base64.b64encode(photo_bytes).decode("ascii")],
                }
            ]
        }
        async with httpx.AsyncClient(
            timeout=settings.face_sync_http_timeout_seconds, auth=_auth(device)
        ) as c:
            r1 = await c.post(url_user, json=body_user)
            # 200 OK or already-exists is fine; otherwise raise.
            if r1.status_code not in (200, 409):
                r1.raise_for_status()
            r2 = await c.post(url_face, json=body_face)
            r2.raise_for_status()
        return employee.employee_code

    async def update(
        self,
        device: Device,
        employee: Employee,
        photo_bytes: bytes,
        vendor_template_id: str | None,
    ) -> str:
        # Dahua AccessFace.cgi is upsert-by-UserID.
        return await self.enroll(device, employee, photo_bytes)

    async def delete(
        self,
        device: Device,
        employee: Employee,
        vendor_template_id: str | None,
    ) -> None:
        if settings.face_sync_dry_run:
            return
        url = (
            f"{_base(device)}/cgi-bin/AccessUser.cgi?action=remove"
            f"&UserID={employee.employee_code}"
        )
        async with httpx.AsyncClient(
            timeout=settings.face_sync_http_timeout_seconds, auth=_auth(device)
        ) as c:
            r = await c.delete(url)
            if r.status_code not in (200, 404):
                r.raise_for_status()
