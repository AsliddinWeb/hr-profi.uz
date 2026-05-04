"""Device schemas."""
from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.device import DeviceLocationRole, DeviceStatus, DeviceVendor
from app.schemas.common import ORMBase


class DeviceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    branch_id: UUID | None = None
    vendor: DeviceVendor = DeviceVendor.HIKVISION
    model: str | None = Field(default=None, max_length=100)
    firmware_version: str | None = Field(default=None, max_length=64)
    serial_number: str = Field(min_length=1, max_length=128)
    ip_address: str | None = Field(default=None, max_length=64)
    mac_address: str | None = Field(default=None, max_length=32)
    location_role: DeviceLocationRole = DeviceLocationRole.BOTH
    config: dict[str, Any] = Field(default_factory=dict)


class DeviceUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    branch_id: UUID | None = None
    model: str | None = Field(default=None, max_length=100)
    firmware_version: str | None = Field(default=None, max_length=64)
    ip_address: str | None = Field(default=None, max_length=64)
    mac_address: str | None = Field(default=None, max_length=32)
    location_role: DeviceLocationRole | None = None
    config: dict[str, Any] | None = None
    is_active: bool | None = None


class DeviceRead(ORMBase):
    id: UUID
    company_id: UUID
    branch_id: UUID | None
    name: str
    vendor: DeviceVendor
    model: str | None
    firmware_version: str | None
    serial_number: str
    ip_address: str | None
    mac_address: str | None
    location_role: DeviceLocationRole
    last_seen_at: datetime | None
    status: DeviceStatus
    config: dict[str, Any]
    is_active: bool
    created_at: datetime
    updated_at: datetime


class DeviceCreateResponse(BaseModel):
    """Returned only on POST. The plaintext ``api_key`` is shown ONCE — admin
    must save it; it can never be retrieved again."""

    device: DeviceRead
    api_key: str


class DeviceLogRead(ORMBase):
    id: UUID
    device_id: UUID
    event_type: str
    payload: dict[str, Any] | None
    received_at: datetime
    employee_id: UUID | None
    success: bool
    error: str | None


# ---------- Webhook payload (vendor-neutral) --------------------------------

class DeviceEvent(BaseModel):
    """Vendor-neutral normalized event.

    Per-vendor adapters in ``device_service`` translate raw HTTP payloads
    (Hikvision ISAPI / ZKTeco PUSH / Dahua HTTP / generic) into this shape
    before the rest of the pipeline runs.

    ``event_external_id`` is the vendor-side event identifier when present —
    we use it as an idempotency key so a re-delivered webhook (after a
    network blip) doesn't create duplicate attendance rows.
    """

    event_type: str = Field(description="face_match | heartbeat | tamper | offline")
    employee_code: str | None = None
    face_match_score: float | None = Field(default=None, ge=0, le=1)
    timestamp: datetime
    direction: str | None = Field(default=None, description="ENTRY | EXIT")
    event_external_id: str | None = Field(
        default=None,
        max_length=128,
        description="Vendor-supplied event ID, used for dedupe.",
    )
    raw: dict[str, Any] = Field(default_factory=dict)


# Back-compat alias — older imports referenced the Hikvision-flavoured name.
HikvisionEvent = DeviceEvent


class HeartbeatPayload(BaseModel):
    timestamp: datetime
    firmware_version: str | None = None
    ip_address: str | None = None


class DeviceCommand(BaseModel):
    """Operational commands the admin can fire at a device.

    REBOOT       — vendor reboot URL (Hikvision /ISAPI/System/reboot etc.)
    RESYNC       — re-enroll every active branch employee. Admin uses this
                   after a device factory-reset or a firmware upgrade
                   wiped the local face library.
    CLEAR        — purge templates without re-enrolling. Used as the
                   destructive step before decommissioning a device.
    """

    action: str = Field(pattern="^(REBOOT|RESYNC|CLEAR)$")
    note: str | None = Field(default=None, max_length=500)


class FaceSyncJobRead(BaseModel):
    """Public view of a sync queue row — used by the admin queue page."""

    id: UUID
    company_id: UUID
    device_id: UUID
    employee_id: UUID
    action: str
    status: str
    attempts: int
    last_error: str | None
    last_attempt_at: datetime | None
    next_retry_at: datetime | None
    photo_url_at_enqueue: str | None
    vendor_template_id: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


__all__ = [
    "DeviceCreate",
    "DeviceCreateResponse",
    "DeviceEvent",
    "DeviceLogRead",
    "DeviceRead",
    "DeviceCommand",
    "DeviceUpdate",
    "FaceSyncJobRead",
    "HeartbeatPayload",
    "HikvisionEvent",
]
