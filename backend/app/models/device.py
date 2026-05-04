"""Face / access control devices.

Currently targeting Hikvision (DS-K1T343 family) — the device authenticates
to the server with an HMAC-signed webhook and posts face-match events. Other
vendors plug into the same model + webhook contract; only the event parser
in ``device_service`` needs to know the vendor.

Lifecycle:
- Admin POSTs `/devices` → server returns a one-time `api_key` (only shown
  once). Device firmware is configured to sign every webhook body with
  HMAC-SHA256 using that key.
- Server stores only the salted bcrypt-style hash of the api_key.
- Device hits `/devices/heartbeat` every N seconds → ``last_seen_at`` bumps.
- A Celery beat job (later phase) sweeps for devices whose heartbeat is
  stale and pushes a ``device_offline`` WS event to the admin panel.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import TYPE_CHECKING, Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TenantMixin, TimestampMixin

if TYPE_CHECKING:
    pass


class DeviceVendor(StrEnum):
    HIKVISION = "HIKVISION"
    DAHUA = "DAHUA"
    ZKTECO = "ZKTECO"
    GENERIC = "GENERIC"


class DeviceLocationRole(StrEnum):
    ENTRY = "ENTRY"
    EXIT = "EXIT"
    BOTH = "BOTH"


class DeviceStatus(StrEnum):
    ONLINE = "ONLINE"
    OFFLINE = "OFFLINE"
    MAINTENANCE = "MAINTENANCE"


class Device(Base, TenantMixin, TimestampMixin):
    __tablename__ = "devices"
    __table_args__ = (
        UniqueConstraint("company_id", "serial_number", name="uq_devices_company_serial"),
    )

    branch_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("branches.id", ondelete="SET NULL"),
        index=True,
    )

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    vendor: Mapped[DeviceVendor] = mapped_column(
        String(16), default=DeviceVendor.HIKVISION.value, nullable=False
    )
    model: Mapped[str | None] = mapped_column(String(100))
    firmware_version: Mapped[str | None] = mapped_column(String(64))
    serial_number: Mapped[str] = mapped_column(String(128), nullable=False)

    # Network identity (informational; admin enters this so it shows up in the
    # device list).
    ip_address: Mapped[str | None] = mapped_column(String(64))
    mac_address: Mapped[str | None] = mapped_column(String(32))

    # bcrypt hash of the API key. The plaintext is shown to the admin once at
    # registration time and never stored.
    api_key_hash: Mapped[str] = mapped_column(String(255), nullable=False)

    location_role: Mapped[DeviceLocationRole] = mapped_column(
        String(8), default=DeviceLocationRole.BOTH.value, nullable=False
    )
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    status: Mapped[DeviceStatus] = mapped_column(
        String(16), default=DeviceStatus.OFFLINE.value, nullable=False, index=True
    )

    # Free-form per-device overrides (face_match_threshold override, working
    # hours, polling interval, etc.). Falls back to company.settings when a
    # key is missing.
    config: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class DeviceLog(Base, TenantMixin, TimestampMixin):
    """Append-only event log for *every* webhook + heartbeat the device sends.

    Acts as the source of truth when admin needs to debug missed clock-ins or
    a vendor-side mismatch — kept small (no FK to attendance) so we can prune
    aggressively (e.g. >90 days) without affecting billing/audit data.
    """

    __tablename__ = "device_logs"

    device_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("devices.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    event_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    employee_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), index=True
    )
    success: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    error: Mapped[str | None] = mapped_column(String(500))
    # Vendor-supplied event id used as the idempotency key. NULL when the
    # vendor doesn't surface one (for those we can't dedupe — best effort).
    external_event_id: Mapped[str | None] = mapped_column(String(128), index=True)
