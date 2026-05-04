"""Hikvision face-template adapter (ISAPI ``/ISAPI/Intelligent/FDLib``).

Endpoints (Digest auth, admin credentials in ``device.config``):

  POST  /ISAPI/Intelligent/FDLib/FaceDataRecord?format=json
    multipart:
      FaceDataRecord (json) + FaceImage (jpeg)
    → returns { "FDID": "1", "FPID": "<vendor template id>" }

  PUT   /ISAPI/Intelligent/FDLib/FDSearch/{FPID}/picture
    body: jpeg

  DELETE /ISAPI/Intelligent/FDLib/FDSearch?FPID={id}

Hikvision identifies a template by ``FPID`` (face-picture id). We persist
that as ``vendor_template_id`` in the FaceSyncJob row so subsequent
update/delete operations can target it precisely.

These calls are HTTP stubs that match the documented shapes — Phase 4
hardware testing will tighten the auth and any vendor-specific quirks.
"""
from __future__ import annotations

import json
import logging
import uuid

import httpx

from app.config import settings
from app.models.device import Device
from app.models.employee import Employee

logger = logging.getLogger(__name__)

FACE_LIB_FDID = "1"  # Hikvision: most devices ship with FDID=1 = "Default Face Library"


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


class HikvisionAdapter:
    async def enroll(
        self, device: Device, employee: Employee, photo_bytes: bytes
    ) -> str:
        if settings.face_sync_dry_run:
            return f"hik-{uuid.uuid4().hex[:10]}"
        url = (
            f"{_base(device)}/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json"
        )
        record = {
            "faceLibType": "blackFD",
            "FDID": FACE_LIB_FDID,
            "FPID": employee.employee_code,
            "name": employee.full_name,
            "gender": "male",  # required field; we don't store it on Employee yet
        }
        files = [
            ("FaceDataRecord", (None, json.dumps(record), "application/json")),
            ("FaceImage", ("face.jpg", photo_bytes, "image/jpeg")),
        ]
        async with httpx.AsyncClient(
            timeout=settings.face_sync_http_timeout_seconds, auth=_auth(device)
        ) as c:
            r = await c.post(url, files=files)
            r.raise_for_status()
            payload = r.json()
            return payload.get("FPID") or employee.employee_code

    async def update(
        self,
        device: Device,
        employee: Employee,
        photo_bytes: bytes,
        vendor_template_id: str | None,
    ) -> str:
        # Hikvision: re-enrol overwrites by FPID (employee_code).
        return await self.enroll(device, employee, photo_bytes)

    async def delete(
        self,
        device: Device,
        employee: Employee,
        vendor_template_id: str | None,
    ) -> None:
        if settings.face_sync_dry_run:
            return
        fpid = vendor_template_id or employee.employee_code
        url = (
            f"{_base(device)}/ISAPI/Intelligent/FDLib/FDSearch?FDID={FACE_LIB_FDID}"
            f"&FPID={fpid}"
        )
        async with httpx.AsyncClient(
            timeout=settings.face_sync_http_timeout_seconds, auth=_auth(device)
        ) as c:
            r = await c.delete(url)
            # 200 + content "deleted" or 200 with details. Don't choke on 404.
            if r.status_code not in (200, 404):
                r.raise_for_status()
