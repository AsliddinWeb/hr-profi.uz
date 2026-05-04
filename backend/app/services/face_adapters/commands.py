"""Out-of-band device commands (reboot, clear templates).

These don't go through the face-sync queue because they're one-shot
operational actions, not data-state propagations. We still respect
``settings.face_sync_dry_run`` so dev runs don't actually try to reach
hardware.
"""
from __future__ import annotations

import logging

import httpx

from app.config import settings
from app.models.device import Device, DeviceVendor

logger = logging.getLogger(__name__)


def _auth(device: Device) -> httpx.DigestAuth | None:
    cfg = device.config or {}
    user = cfg.get("admin_user")
    pw = cfg.get("admin_password")
    if user and pw:
        return httpx.DigestAuth(user, pw)
    return None


async def reboot(device: Device) -> None:
    """Vendor-specific reboot URL. Most boxes accept a simple PUT/POST.

    Failures are surfaced (the caller should catch and translate to a
    helpful error). Dry-run returns silently.
    """
    if settings.face_sync_dry_run:
        return
    if not device.ip_address:
        raise RuntimeError("device.no_ip_address")
    base = f"http://{device.ip_address}"

    vendor = (
        device.vendor.value
        if hasattr(device.vendor, "value")
        else str(device.vendor)
    )
    if vendor == DeviceVendor.HIKVISION.value:
        url = f"{base}/ISAPI/System/reboot"
        async with httpx.AsyncClient(
            timeout=settings.face_sync_http_timeout_seconds, auth=_auth(device)
        ) as c:
            r = await c.put(url)
            r.raise_for_status()
        return
    if vendor == DeviceVendor.DAHUA.value:
        url = f"{base}/cgi-bin/magicBox.cgi?action=reboot"
        async with httpx.AsyncClient(
            timeout=settings.face_sync_http_timeout_seconds, auth=_auth(device)
        ) as c:
            r = await c.get(url)
            r.raise_for_status()
        return
    if vendor == DeviceVendor.ZKTECO.value:
        url = f"{base}/iWsService/cdata?SN={device.serial_number}"
        async with httpx.AsyncClient(
            timeout=settings.face_sync_http_timeout_seconds
        ) as c:
            r = await c.post(
                url,
                content="C:1:CLEAR\nC:1:REBOOT\n",
                headers={"Content-Type": "text/plain"},
            )
            r.raise_for_status()
        return
    # GENERIC: best-effort POST {base}/system/reboot. Custom integrations
    # are expected to wire this up themselves.
    url = f"{base}/system/reboot"
    async with httpx.AsyncClient(
        timeout=settings.face_sync_http_timeout_seconds
    ) as c:
        r = await c.post(url)
        r.raise_for_status()
