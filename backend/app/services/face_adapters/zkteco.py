"""ZKTeco face-template adapter (PUSH-style HTTP cdata).

ZKTeco terminals support a PUSH protocol where the *device* polls the
server, but for outbound operations there's a complementary "command"
endpoint on the device itself (``/iWsService/cdata``) that accepts a
plain-text command string. Real production setups usually rely on
ZKBio CV / BioTime, but for minimum-viable out-of-the-box support we
post directly to the device.

For face templates ZKTeco wants raw template bytes (not a JPEG) — a real
deployment has to either (a) extract the template via the device's local
"register" flow, or (b) pre-compute it from a reference photo using the
ZK SDK. Since we can't run that SDK here, this adapter falls back to
"upload JPEG and let the device build the template" via the BIOPHOTO
command, which most modern firmware versions accept.
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


class ZktecoAdapter:
    async def enroll(
        self, device: Device, employee: Employee, photo_bytes: bytes
    ) -> str:
        if settings.face_sync_dry_run:
            return f"zkt-{uuid.uuid4().hex[:10]}"
        # Two commands: USERINFO (create user) + BIOPHOTO (push photo).
        url = f"{_base(device)}/iWsService/cdata?SN={device.serial_number}"
        payload = (
            f"USERINFO PIN={employee.employee_code}\t"
            f"Name={employee.full_name or employee.employee_code}\t"
            "Privilege=0\n"
            f"BIOPHOTO PIN={employee.employee_code}\t"
            f"FileName={employee.employee_code}.jpg\t"
            f"Type=9\t"
            f"Size={len(photo_bytes)}\t"
            f"Content={base64.b64encode(photo_bytes).decode('ascii')}\n"
        )
        async with httpx.AsyncClient(
            timeout=settings.face_sync_http_timeout_seconds
        ) as c:
            r = await c.post(
                url, content=payload, headers={"Content-Type": "text/plain"}
            )
            r.raise_for_status()
        # ZKTeco doesn't echo a vendor template id — we use the PIN itself.
        return employee.employee_code

    async def update(
        self,
        device: Device,
        employee: Employee,
        photo_bytes: bytes,
        vendor_template_id: str | None,
    ) -> str:
        # ZKTeco BIOPHOTO is upsert-by-PIN; same path as enroll.
        return await self.enroll(device, employee, photo_bytes)

    async def delete(
        self,
        device: Device,
        employee: Employee,
        vendor_template_id: str | None,
    ) -> None:
        if settings.face_sync_dry_run:
            return
        url = f"{_base(device)}/iWsService/cdata?SN={device.serial_number}"
        payload = f"DATA DELETE USERINFO PIN={employee.employee_code}\n"
        async with httpx.AsyncClient(
            timeout=settings.face_sync_http_timeout_seconds
        ) as c:
            r = await c.post(
                url, content=payload, headers={"Content-Type": "text/plain"}
            )
            if r.status_code not in (200, 404):
                r.raise_for_status()
