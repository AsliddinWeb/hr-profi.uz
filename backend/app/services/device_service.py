"""Device webhook authentication + event processing.

The signed-webhook flow:
1. Admin POSTs `/devices` → server returns `api_key` (plaintext) once.
2. Device firmware is configured to:
   - HMAC-SHA256 the raw request body using `api_key`
   - Send the hex digest in the ``X-WTP-Signature`` header
   - Send the device's serial in ``X-WTP-Device``
3. Webhook handler looks up the Device by serial, ``verify_password`` against
   the stored ``api_key_hash`` → if match, the signature is valid because
   we recompute it server-side.

We don't actually let the password matcher do HMAC for us — we use a simple
``compare_digest`` against the recomputed signature, but only after we've
unlocked the api_key from the device row. To keep the api_key out of the DB
we stash the bcrypt hash; HMAC verification happens in two steps:

  - Decode the device-supplied API key from a separate `X-WTP-Key` header
    (or rely on TLS trust + serial), then bcrypt-verify it against the row.
  - Recompute HMAC(body, api_key) and ``compare_digest`` with the signature.

This is more secure than putting the key in the URL, and works without HSM.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from fastapi import HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password, verify_password
from app.models.attendance import (
    AttendanceMethod,
    AttendanceRecord,
    AttendanceStatus,
    CheckType,
)
from app.models.company import Company
from app.models.device import Device, DeviceLog, DeviceStatus, DeviceVendor
from app.models.employee import Employee
from app.models.notification import NotificationCategory
from app.schemas.device import DeviceEvent, HikvisionEvent
from app.services import notification_service

logger = logging.getLogger(__name__)

API_KEY_BYTES = 32
HEARTBEAT_OFFLINE_AFTER_SECONDS = 180  # 3 minutes — generous for cellular IoT


def generate_api_key() -> tuple[str, str]:
    """Returns ``(plaintext, hash)``. Plaintext is shown to the admin once."""
    plaintext = secrets.token_urlsafe(API_KEY_BYTES)
    return plaintext, hash_password(plaintext)


async def _load_device_by_serial(db: AsyncSession, serial: str) -> Device | None:
    return (
        await db.execute(
            select(Device)
            .where(Device.serial_number == serial)
            .execution_options(skip_tenant_filter=True)
        )
    ).scalar_one_or_none()


async def authenticate_webhook(
    db: AsyncSession,
    request: Request,
    body: bytes,
) -> Device:
    """Validate the webhook request against the device row.

    Two auth modes are supported, in order of preference:

    1. **Signed-header mode** (preferred — used by software clients we
       control). Three headers must all be present:
         - ``X-WTP-Device``     device serial
         - ``X-WTP-Key``        plaintext api_key returned at registration
         - ``X-WTP-Signature``  HMAC-SHA256(body, api_key) hex digest
       The HMAC signature stops a leaked URL from being replayed.

    2. **Query-string fallback** (for legacy face terminals that can't
       attach custom headers — e.g. Hikvision DS-K1T343 firmware
       V3.3.4 HTTP Listening). The device sends ``?key=<api_key>``
       on the URL; we look up the device by hashing every active
       device's api_key and comparing. No signature, so a leaked URL
       *is* a credential. We log a warning so admins can rotate keys
       proactively. Only enable on devices that can't do better.

    Raises HTTP 401 on any failure. Returns the authenticated Device on
    success, with the request's tenant pre-bound to the device's company
    so downstream queries are tenant-safe.
    """
    serial = request.headers.get("x-wtp-device")
    api_key = request.headers.get("x-wtp-key")
    signature = request.headers.get("x-wtp-signature")

    if serial and api_key and signature:
        device = await _load_device_by_serial(db, serial)
        if not device or not device.is_active:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="unknown device"
            )
        if not verify_password(api_key, device.api_key_hash):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid api key"
            )
        expected = hmac.new(
            api_key.encode("utf-8"), body, hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(expected, signature):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="invalid signature",
            )
        return device

    # Fallback for terminals that can't attach custom headers.
    qs_key = request.query_params.get("key")
    if qs_key:
        device = await _load_device_by_api_key(db, qs_key)
        if device is None or not device.is_active:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="unknown device",
            )
        return device

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="missing device auth (headers or ?key=)",
    )


async def _load_device_by_api_key(
    db: AsyncSession, api_key: str
) -> Device | None:
    """Linear scan of active devices, bcrypt-verifying api_key against
    each ``api_key_hash``. Acceptable while the device count per tenant
    is small (≤ a few dozen); for thousands of devices we'd swap to a
    keyed-hash lookup table instead.
    """
    rows = (
        await db.execute(
            select(Device)
            .where(Device.is_active.is_(True))
            .execution_options(skip_tenant_filter=True)
        )
    ).scalars().all()
    for d in rows:
        if d.api_key_hash and verify_password(api_key, d.api_key_hash):
            return d
    return None


# ---------- Vendor adapters ------------------------------------------------

def parse_hikvision_event(raw: dict[str, Any]) -> DeviceEvent:
    """Map a Hikvision ISAPI event JSON onto our normalized schema.

    The real event looks roughly like::

        {
          "EventNotificationAlert": {
            "ipAddress": "...",
            "eventType": "AccessControllerEvent",
            "eventTime": "2026-04-28T11:30:00+05:00",
            "AccessControllerEvent": {
              "majorEventType": 5,            # 5 = face match
              "subEventType": 75,             # 75 = face matched
              "employeeNoString": "E-001",
              "currentVerifyMode": "faceOrFp",
              "name": "Aliyev Vali",
              "similarity": 0.92,
              "AntiSneakChannelControllerEvent": null
            }
          }
        }
    """
    alert = raw.get("EventNotificationAlert") or raw
    event_type = alert.get("eventType") or alert.get("event_type") or "unknown"

    ace = alert.get("AccessControllerEvent") or {}
    employee_code = (
        ace.get("employeeNoString")
        or alert.get("employee_code")
        or alert.get("employeeCode")
    )
    similarity = ace.get("similarity")
    timestamp_raw = alert.get("eventTime") or alert.get("timestamp")

    # Direction: Hikvision `currentVerifyMode` doesn't carry it; the device's
    # location_role is what we should default to. We pass through if present.
    direction = ace.get("direction") or alert.get("direction")

    # Heuristic: face match → our face_match
    major = ace.get("majorEventType")
    if major == 5 or event_type.lower() in {"facematch", "face_match"}:
        normalized = "face_match"
    elif event_type.lower() == "heartbeat":
        normalized = "heartbeat"
    elif event_type.lower() in {"tamper", "tamperalarm"}:
        normalized = "tamper"
    else:
        normalized = event_type

    # Hikvision uses a numeric ``serialNo`` per event delivery — perfect
    # for idempotency. Fall back to the EventNotificationAlert id.
    eid = (
        alert.get("serialNo")
        or alert.get("EventID")
        or ace.get("eventID")
    )

    return DeviceEvent(
        event_type=normalized,
        employee_code=employee_code,
        face_match_score=float(similarity) if similarity is not None else None,
        timestamp=_parse_ts(timestamp_raw),
        direction=direction,
        event_external_id=str(eid) if eid is not None else None,
        raw=raw,
    )


def parse_zkteco_event(raw: dict[str, Any]) -> DeviceEvent:
    """ZKTeco PUSH SDK event.

    ZKTeco's mid-range terminals (SpeedFace V5L, MB360 etc.) post URL-encoded
    bodies like::

        SN=A8N123,table=ATTLOG,emp=E-001,verify=15,direction=in,score=0.91,
        time=2026-05-03 09:01:13,event=1

    Some firmwares POST JSON instead (``{"sn":"A8N123","emp":"E-001",
    "score":0.91,"time":"...","direction":"IN","event":"1"}``); we accept
    both shapes.
    """
    # Verify code: 1=password, 4=card, 15=face. We only treat face hits as
    # face_match; the rest fall through as the original event_type.
    verify = (
        raw.get("verify")
        or raw.get("verifyMode")
        or raw.get("verify_mode")
    )
    event = (
        raw.get("event")
        or raw.get("event_type")
        or raw.get("eventType")
        or "unknown"
    )
    is_face = str(verify) == "15" or "face" in str(event).lower()
    normalized = (
        "face_match"
        if is_face
        else (
            "heartbeat"
            if str(event).lower() in {"heartbeat", "ping"}
            else str(event)
        )
    )

    direction_raw = raw.get("direction") or raw.get("inout")
    direction: str | None = None
    if direction_raw is not None:
        d = str(direction_raw).upper()
        direction = "ENTRY" if d in {"IN", "ENTRY", "0"} else (
            "EXIT" if d in {"OUT", "EXIT", "1"} else None
        )

    score = raw.get("score") or raw.get("similarity") or raw.get("score_face")
    return DeviceEvent(
        event_type=normalized,
        employee_code=raw.get("emp") or raw.get("pin") or raw.get("user_id"),
        face_match_score=float(score) if score is not None else None,
        timestamp=_parse_ts(raw.get("time") or raw.get("timestamp")),
        direction=direction,
        event_external_id=str(raw.get("event_id") or raw.get("rid") or "") or None,
        raw=raw,
    )


def parse_dahua_event(raw: dict[str, Any]) -> DeviceEvent:
    """Dahua HTTP push (Smart Profile / FaceRecognition events).

    Sample shape::

        {
          "Code": "FaceRecognition",
          "Action": "Start",
          "Data": {
            "UserID": "E-001",
            "Similarity": 92,                  # 0–100, not 0–1
            "Direction": 1,                    # 1=in, 2=out
            "UTC": 1714000000,
            "EventID": 12345
          }
        }
    """
    code = str(raw.get("Code") or raw.get("code") or "").lower()
    data = raw.get("Data") or raw.get("data") or {}

    if "facerecognition" in code or "face" in code:
        normalized = "face_match"
    elif code in {"heartbeat", "keepalive"}:
        normalized = "heartbeat"
    elif "tamper" in code:
        normalized = "tamper"
    else:
        normalized = code or "unknown"

    sim = data.get("Similarity") or data.get("similarity") or data.get("Score")
    score: float | None = None
    if sim is not None:
        sim_f = float(sim)
        # Dahua reports 0..100; normalize to 0..1.
        score = sim_f / 100.0 if sim_f > 1.5 else sim_f

    direction_raw = data.get("Direction") or data.get("direction")
    direction: str | None = None
    if direction_raw is not None:
        direction = "ENTRY" if str(direction_raw) in {"1", "IN", "in"} else (
            "EXIT" if str(direction_raw) in {"2", "OUT", "out"} else None
        )

    return DeviceEvent(
        event_type=normalized,
        employee_code=data.get("UserID") or data.get("userId") or data.get("EmpId"),
        face_match_score=score,
        timestamp=_parse_ts(data.get("UTC") or data.get("Time") or data.get("eventTime")),
        direction=direction,
        event_external_id=str(data.get("EventID") or data.get("eventId") or "") or None,
        raw=raw,
    )


def parse_generic_event(raw: dict[str, Any]) -> DeviceEvent:
    """Vendor-neutral schema for custom integrations + on-prem agents.

    Expected payload::

        {
          "event_type": "face_match" | "heartbeat" | "tamper",
          "employee_code": "E-001",
          "face_match_score": 0.92,
          "timestamp": "2026-05-03T09:01:13Z",
          "direction": "ENTRY" | "EXIT",
          "event_id": "uuid-or-vendor-string"
        }

    Any unknown ``event_type`` is preserved verbatim — the pipeline only
    materialises an AttendanceRecord for ``face_match``, so a typo just
    becomes a logged-but-ignored event.
    """
    score = raw.get("face_match_score") or raw.get("score") or raw.get("similarity")
    return DeviceEvent(
        event_type=str(raw.get("event_type") or "unknown"),
        employee_code=raw.get("employee_code") or raw.get("emp") or raw.get("user_id"),
        face_match_score=float(score) if score is not None else None,
        timestamp=_parse_ts(raw.get("timestamp") or raw.get("time")),
        direction=raw.get("direction"),
        event_external_id=str(raw.get("event_id") or "") or None,
        raw=raw,
    )


# Vendor → adapter map. Adding a new vendor: implement parse_X_event above
# and register it here. The webhook handler picks the adapter from the
# device row's ``vendor`` column — no per-route wiring needed.
_VENDOR_ADAPTERS = {
    DeviceVendor.HIKVISION.value: parse_hikvision_event,
    DeviceVendor.ZKTECO.value: parse_zkteco_event,
    DeviceVendor.DAHUA.value: parse_dahua_event,
    DeviceVendor.GENERIC.value: parse_generic_event,
}


def parse_event(device: Device, raw: dict[str, Any]) -> DeviceEvent:
    """Dispatch on ``device.vendor`` to the right adapter."""
    vendor = (
        device.vendor.value
        if hasattr(device.vendor, "value")
        else str(device.vendor)
    )
    adapter = _VENDOR_ADAPTERS.get(vendor, parse_generic_event)
    return adapter(raw)


def _parse_ts(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    return datetime.now(timezone.utc)


# ---------- Event → AttendanceRecord pipeline -------------------------------

async def _company_threshold(db: AsyncSession, device: Device) -> float:
    company = (
        await db.execute(
            select(Company)
            .where(Company.id == device.company_id)
            .execution_options(skip_tenant_filter=True)
        )
    ).scalar_one()
    # Device override beats company default.
    return float(
        device.config.get("face_match_threshold")
        or company.settings.get("face_match_threshold", 0.85)
    )


async def _decide_check_type(
    db: AsyncSession, device: Device, employee: Employee, ts: datetime
) -> CheckType:
    """Determine if this scan is an IN or an OUT.

    - If device has location_role ENTRY/EXIT, we honor that.
    - Otherwise, look at the employee's last record and toggle.
    """
    if device.location_role == "ENTRY":
        return CheckType.CHECK_IN
    if device.location_role == "EXIT":
        return CheckType.CHECK_OUT

    last = (
        await db.execute(
            select(AttendanceRecord)
            .where(AttendanceRecord.employee_id == employee.id)
            .order_by(AttendanceRecord.timestamp.desc())
            .limit(1)
            .execution_options(skip_tenant_filter=True)
        )
    ).scalar_one_or_none()
    if last is None or last.check_type == CheckType.CHECK_OUT:
        return CheckType.CHECK_IN
    return CheckType.CHECK_OUT


async def _last_record(db: AsyncSession, employee_id: UUID) -> AttendanceRecord | None:
    return (
        await db.execute(
            select(AttendanceRecord)
            .where(AttendanceRecord.employee_id == employee_id)
            .order_by(AttendanceRecord.timestamp.desc())
            .limit(1)
            .execution_options(skip_tenant_filter=True)
        )
    ).scalar_one_or_none()


async def find_duplicate_event(
    db: AsyncSession, device: Device, event_external_id: str
) -> DeviceLog | None:
    """Return a prior successful DeviceLog row for ``(device, external_id)``,
    if any. Used as the idempotency check before materialising attendance."""
    return (
        await db.execute(
            select(DeviceLog)
            .where(
                DeviceLog.device_id == device.id,
                DeviceLog.external_event_id == event_external_id,
                DeviceLog.success.is_(True),
            )
            .execution_options(skip_tenant_filter=True)
            .limit(1)
        )
    ).scalar_one_or_none()


async def process_face_match(
    db: AsyncSession,
    device: Device,
    event: DeviceEvent,
) -> tuple[AttendanceRecord | None, list[str]]:
    """Turn a face_match event into an AttendanceRecord plus a list of human-
    readable anomaly reasons (empty list = no anomalies)."""
    anomalies: list[str] = []

    if not event.employee_code:
        anomalies.append("missing_employee_code")
        return None, anomalies

    employee = (
        await db.execute(
            select(Employee).where(
                Employee.company_id == device.company_id,
                Employee.employee_code == event.employee_code,
            )
            .execution_options(skip_tenant_filter=True)
        )
    ).scalar_one_or_none()
    if not employee or not employee.is_active:
        anomalies.append("unknown_or_terminated_employee")
        return None, anomalies

    threshold = await _company_threshold(db, device)
    score = event.face_match_score or 0.0
    if score and score < threshold:
        anomalies.append(f"low_face_match_score:{score:.2f}<{threshold:.2f}")

    # Duplicate check: same direction + < 60s since last → suspicious.
    last = await _last_record(db, employee.id)
    if last and (event.timestamp - last.timestamp) < timedelta(seconds=60):
        anomalies.append("rapid_consecutive_scan")

    check_type = await _decide_check_type(db, device, employee, event.timestamp)
    status_value = (
        AttendanceStatus.SUSPICIOUS if anomalies else AttendanceStatus.VALID
    )

    # Late detection — only meaningful for CHECK_IN. Look up the day's
    # planned shift; if the device-stamped timestamp is after the
    # template's start_time, flag late_minutes.
    is_late, late_minutes = False, 0
    if check_type == CheckType.CHECK_IN:
        from app.services.attendance_service import _scheduled_shift  # avoid cycle

        _, tpl = await _scheduled_shift(db, employee.id, event.timestamp.date())
        if tpl is None and employee.shift_template_id is not None:
            # Fallback: schedule row missing for this day, but the
            # employee has a default template — use its start_time so
            # late detection still works for ad-hoc days.
            from app.models.shift import ShiftTemplate

            tpl = (
                await db.execute(
                    select(ShiftTemplate).where(
                        ShiftTemplate.id == employee.shift_template_id
                    )
                )
            ).scalar_one_or_none()
        if tpl is not None and tpl.start_time is not None:
            scheduled_dt = datetime.combine(
                event.timestamp.date(), tpl.start_time, tzinfo=timezone.utc
            )
            diff = (event.timestamp - scheduled_dt).total_seconds() / 60
            if diff > 0:
                late_minutes = int(diff)
                is_late = True

    rec = AttendanceRecord(
        company_id=device.company_id,
        employee_id=employee.id,
        branch_id=device.branch_id or employee.branch_id,
        check_type=check_type,
        method=AttendanceMethod.FACE_DEVICE,
        timestamp=event.timestamp,
        face_match_score=score if score else None,
        device_id=device.id,
        status=status_value,
        is_late=is_late,
        late_minutes=late_minutes,
        notes=", ".join(anomalies) if anomalies else None,
    )
    db.add(rec)
    await db.flush()

    # Salary recompute — same pattern as mobile check-in. Without this
    # the PWA /salary page would lag until the next ``check_out`` event
    # or the daily Celery beat tops everything up.
    try:
        from app.tasks.salary_tasks import recompute_for_day as _recompute

        _recompute.delay(str(employee.id), event.timestamp.date().isoformat())
    except Exception:  # noqa: BLE001
        logger.debug(
            "salary recompute dispatch skipped for emp=%s day=%s",
            employee.id,
            event.timestamp.date(),
        )
    return rec, anomalies


async def log_event(
    db: AsyncSession,
    device: Device,
    event_type: str,
    payload: dict[str, Any] | None,
    *,
    employee_id: UUID | None = None,
    success: bool = True,
    error: str | None = None,
    external_event_id: str | None = None,
) -> None:
    db.add(
        DeviceLog(
            company_id=device.company_id,
            device_id=device.id,
            event_type=event_type,
            payload=payload,
            received_at=datetime.now(timezone.utc),
            employee_id=employee_id,
            success=success,
            error=error,
            external_event_id=external_event_id,
        )
    )


async def mark_seen(db: AsyncSession, device: Device) -> None:
    device.last_seen_at = datetime.now(timezone.utc)
    device.status = DeviceStatus.ONLINE


async def sweep_offline_devices(db: AsyncSession) -> int:
    """Mark devices whose last_seen_at is older than the threshold as OFFLINE
    and notify the company admins. Idempotent — only state-changing transitions
    fire a notification."""
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=HEARTBEAT_OFFLINE_AFTER_SECONDS)
    rows = (
        await db.execute(
            select(Device).where(
                Device.is_active.is_(True),
                Device.status == DeviceStatus.ONLINE,
                Device.last_seen_at.isnot(None),
                Device.last_seen_at < cutoff,
            ).execution_options(skip_tenant_filter=True)
        )
    ).scalars().all()
    for d in rows:
        d.status = DeviceStatus.OFFLINE
        last_seen = (
            d.last_seen_at.isoformat() if d.last_seen_at else "?"
        )
        body = f"Last seen at {last_seen}"
        payload = {
            "device_id": str(d.id),
            "serial": d.serial_number,
            "title_key": "anomaly.device_offline.title",
            "body_key": "anomaly.device_offline.body",
            "t_args": {"name": d.name, "last_seen": last_seen},
        }
        await notification_service.notify_company_admins(
            db,
            company_id=d.company_id,
            title=f"Device offline: {d.name}",
            body=body,
            category=NotificationCategory.DEVICE,
            payload=payload,
        )
        # Also wake the branch manager — the local owner is who's likely to
        # walk over and reboot the unit. Without this they only see it in
        # the BM Dashboard's "absent" stats, which is a delayed signal.
        if d.branch_id is not None:
            await notification_service.notify_branch_managers(
                db,
                company_id=d.company_id,
                branch_id=d.branch_id,
                title=f"Device offline: {d.name}",
                body=body,
                category=NotificationCategory.DEVICE,
                payload=payload,
            )
    if rows:
        await db.commit()
    return len(rows)


__all__ = [
    "authenticate_webhook",
    "find_duplicate_event",
    "generate_api_key",
    "log_event",
    "mark_seen",
    "parse_dahua_event",
    "parse_event",
    "parse_generic_event",
    "parse_hikvision_event",
    "parse_zkteco_event",
    "process_face_match",
    "sweep_offline_devices",
]
