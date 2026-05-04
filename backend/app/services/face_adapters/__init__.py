"""Per-vendor face-template enrollment adapters.

The contract every adapter implements:
  - ``enroll(device, employee, photo_bytes) -> str``  (returns vendor template id)
  - ``update(device, employee, photo_bytes, vendor_template_id) -> str``
  - ``delete(device, employee, vendor_template_id) -> None``

Real vendor SDK calls live in each ``<vendor>.py`` file. Today these are
HTTP-based stubs that match the documented endpoints; the actual hardware
integration happens in Phase 4 when we have devices to test against. In
the meantime the dispatcher allows ``settings.face_sync_dry_run`` to short-
circuit network calls so the queue exercises end-to-end in dev.
"""
from __future__ import annotations

from typing import Protocol

from app.models.device import Device, DeviceVendor
from app.models.employee import Employee


class FaceAdapter(Protocol):
    async def enroll(
        self, device: Device, employee: Employee, photo_bytes: bytes
    ) -> str: ...

    async def update(
        self,
        device: Device,
        employee: Employee,
        photo_bytes: bytes,
        vendor_template_id: str | None,
    ) -> str: ...

    async def delete(
        self,
        device: Device,
        employee: Employee,
        vendor_template_id: str | None,
    ) -> None: ...


def for_device(device: Device) -> FaceAdapter:
    """Pick the right adapter for ``device.vendor``."""
    vendor = (
        device.vendor.value
        if hasattr(device.vendor, "value")
        else str(device.vendor)
    )
    if vendor == DeviceVendor.HIKVISION.value:
        from app.services.face_adapters.hikvision import HikvisionAdapter

        return HikvisionAdapter()
    if vendor == DeviceVendor.ZKTECO.value:
        from app.services.face_adapters.zkteco import ZktecoAdapter

        return ZktecoAdapter()
    if vendor == DeviceVendor.DAHUA.value:
        from app.services.face_adapters.dahua import DahuaAdapter

        return DahuaAdapter()
    from app.services.face_adapters.generic import GenericAdapter

    return GenericAdapter()
