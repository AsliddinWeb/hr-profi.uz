"""Attendance business logic.

Phase 2 scope:
- Mobile check-in / check-out create the row, snapshot lat/lng/selfie URL,
  flag is_late vs the day's planned shift (if any).
- Geofence + late detection are best-effort: if no schedule and no branch
  geofence is set, the record is still VALID — admin can adjust later.
- Anomaly detection (mock GPS, low face score) and salary recompute hooks
  land in Phase 3/4.
"""
from __future__ import annotations

import base64
import binascii
import logging
from datetime import date, datetime, time, timedelta, timezone
from math import asin, cos, radians, sin, sqrt
from uuid import UUID

from sqlalchemy import and_, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConflictError, NotFoundError
from app.models.attendance import (
    AttendanceMethod,
    AttendanceRecord,
    AttendanceStatus,
    CheckType,
)
from app.models.branch import Branch
from app.models.employee import Employee
from app.models.shift import ShiftSchedule, ShiftTemplate
from app.models.user import User
from app.schemas.attendance import CheckInRequest, TodayStatus

logger = logging.getLogger(__name__)


def _maybe_upload_selfie(
    selfie_base64: str | None, *, company_id: UUID
) -> str | None:
    """Decode a ``data:image/jpeg;base64,...`` (or bare base64) payload and
    upload to MinIO under ``{company_id}/attendance/...``.

    Returns the public URL, or ``None`` if no selfie was sent. Errors are
    logged and swallowed — a failed selfie upload should never block the
    check-in itself, since the attendance record is the source of truth.
    """
    if not selfie_base64:
        return None
    raw = selfie_base64
    content_type = "image/jpeg"
    if raw.startswith("data:"):
        # ``data:image/png;base64,...`` — split off the prefix and grab the
        # mime type so PNG selfies aren't mis-saved as JPEG.
        try:
            header, raw = raw.split(",", 1)
            if ":" in header and ";" in header:
                content_type = header.split(":", 1)[1].split(";", 1)[0]
        except ValueError:
            return None
    try:
        data = base64.b64decode(raw, validate=False)
    except (binascii.Error, ValueError):
        logger.warning("attendance: invalid base64 selfie")
        return None
    if not data:
        return None
    try:
        from app.services.storage_service import (
            ALLOWED_IMAGE_TYPES,
            upload_image_bytes,
        )

        if content_type not in ALLOWED_IMAGE_TYPES:
            content_type = "image/jpeg"
        return upload_image_bytes(
            company_id=company_id,
            module="attendance",
            data=data,
            content_type=content_type,
        )
    except Exception:  # noqa: BLE001
        logger.exception("attendance: selfie upload failed")
        return None


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distance in meters between two GPS coords."""
    r = 6_371_000
    p1, p2 = radians(lat1), radians(lat2)
    dp = radians(lat2 - lat1)
    dl = radians(lon2 - lon1)
    a = sin(dp / 2) ** 2 + cos(p1) * cos(p2) * sin(dl / 2) ** 2
    return 2 * r * asin(sqrt(a))


async def _employee_for_user(db: AsyncSession, user: User) -> Employee:
    emp = (
        await db.execute(select(Employee).where(Employee.user_id == user.id))
    ).scalar_one_or_none()
    if not emp:
        raise NotFoundError("employee.not_found")
    if not emp.is_active:
        raise NotFoundError("employee.terminated")
    return emp


async def _scheduled_shift(
    db: AsyncSession, employee_id: UUID, day: date
) -> tuple[ShiftSchedule | None, ShiftTemplate | None]:
    sched = (
        await db.execute(
            select(ShiftSchedule).where(
                ShiftSchedule.employee_id == employee_id,
                ShiftSchedule.date == day,
            )
        )
    ).scalar_one_or_none()
    if not sched or not sched.shift_template_id:
        return sched, None
    tpl = (
        await db.execute(
            select(ShiftTemplate).where(ShiftTemplate.id == sched.shift_template_id)
        )
    ).scalar_one_or_none()
    return sched, tpl


async def _last_record(
    db: AsyncSession, employee_id: UUID
) -> AttendanceRecord | None:
    return (
        await db.execute(
            select(AttendanceRecord)
            .where(AttendanceRecord.employee_id == employee_id)
            .order_by(desc(AttendanceRecord.timestamp))
            .limit(1)
        )
    ).scalar_one_or_none()


def _is_within_geofence(branch: Branch | None, lat: float | None, lng: float | None) -> bool:
    if branch is None or branch.latitude is None or branch.longitude is None:
        return True  # No geofence configured — accept.
    if lat is None or lng is None:
        return False
    distance = _haversine_m(branch.latitude, branch.longitude, lat, lng)
    return distance <= float(branch.geofence_radius_m or 0)


async def _resolve_branch(db: AsyncSession, branch_id: UUID | None) -> Branch | None:
    if branch_id is None:
        return None
    return (
        await db.execute(select(Branch).where(Branch.id == branch_id))
    ).scalar_one_or_none()


async def _block_if_on_leave(db: AsyncSession, employee_id: UUID, day: date) -> None:
    """Refuse a check-in/out when the employee has an approved leave for the
    day — the system would happily accept it otherwise (and the salary engine
    would then double-count the day as both worked and on-leave). Better to
    surface a clear error to the user."""
    from app.models.leave import LeaveRequest, LeaveStatus

    hit = (
        await db.execute(
            select(LeaveRequest.id)
            .where(
                LeaveRequest.employee_id == employee_id,
                LeaveRequest.status == LeaveStatus.APPROVED.value,
                LeaveRequest.start_date <= day,
                LeaveRequest.end_date >= day,
            )
            .execution_options(skip_tenant_filter=True)
            .limit(1)
        )
    ).scalar_one_or_none()
    if hit is not None:
        raise ConflictError("attendance.on_leave")


async def check_in(
    db: AsyncSession,
    user: User,
    data: CheckInRequest,
    *,
    method: AttendanceMethod = AttendanceMethod.MOBILE_APP,
    ip_address: str | None = None,
) -> AttendanceRecord:
    emp = await _employee_for_user(db, user)
    last = await _last_record(db, emp.id)
    if last and last.check_type == CheckType.CHECK_IN:
        raise ConflictError("attendance.already_checked_in")

    now = datetime.now(timezone.utc)
    today = now.date()
    await _block_if_on_leave(db, emp.id, today)

    sched, tpl = await _scheduled_shift(db, emp.id, today)
    if tpl is None and emp.shift_template_id is not None:
        # Fallback: ShiftSchedule row missing for today (e.g. employee
        # was assigned a template before the auto-regenerator ran, or
        # the calendar hasn't been bootstrapped yet). Use the employee's
        # default template's start_time so late detection still fires.
        tpl = (
            await db.execute(
                select(ShiftTemplate).where(ShiftTemplate.id == emp.shift_template_id)
            )
        ).scalar_one_or_none()
    is_late, late_minutes = False, 0
    if tpl and tpl.start_time is not None:
        scheduled_dt = datetime.combine(today, tpl.start_time, tzinfo=timezone.utc)
        diff = (now - scheduled_dt).total_seconds() / 60
        if diff > 0:
            late_minutes = int(diff)
            # Late grace per company settings would go here; for Phase 2 a
            # naive >0 == late is fine.
            is_late = late_minutes > 0

    branch = await _resolve_branch(db, data.branch_id or emp.branch_id)
    in_geofence = _is_within_geofence(branch, data.latitude, data.longitude)
    status = AttendanceStatus.VALID if in_geofence else AttendanceStatus.SUSPICIOUS

    selfie_url = _maybe_upload_selfie(data.selfie_base64, company_id=emp.company_id)

    rec = AttendanceRecord(
        company_id=emp.company_id,
        employee_id=emp.id,
        branch_id=branch.id if branch else None,
        check_type=CheckType.CHECK_IN,
        method=method,
        timestamp=now,
        latitude=data.latitude,
        longitude=data.longitude,
        accuracy_m=data.accuracy_m,
        selfie_url=selfie_url,
        is_late=is_late,
        late_minutes=late_minutes,
        is_early_leave=False,
        overtime_minutes=0,
        status=status,
        ip_address=ip_address,
        notes=data.notes,
    )
    db.add(rec)
    await db.commit()
    await db.refresh(rec)
    if not in_geofence:
        # Store i18n key + arguments alongside the English fallback. The
        # frontend prefers ``payload.t_key`` over the stored title when
        # rendering, so the same row reads as Uzbek/Russian/English to
        # whoever's logged in. We keep the English ``title``/``body``
        # fields populated for legacy clients and notification digests
        # (email/Telegram in a later phase).
        await _notify_anomaly(
            db,
            company_id=emp.company_id,
            branch_id=emp.branch_id,
            title="Out-of-geofence check-in",
            body=f"{emp.full_name} checked in outside the branch radius.",
            payload={
                "employee_id": str(emp.id),
                "lat": data.latitude,
                "lng": data.longitude,
                "title_key": "anomaly.geofence_in.title",
                "body_key": "anomaly.geofence_in.body",
                "t_args": {"name": emp.full_name or emp.employee_code},
            },
        )
    return rec


def _enqueue_salary_recompute(employee_id: UUID, day: date) -> None:
    """Fire-and-forget Celery dispatch. Lazy import keeps Celery off the API
    import path (so tests don't need a broker)."""
    try:
        from app.tasks.salary_tasks import recompute_for_day as _task

        _task.delay(str(employee_id), day.isoformat())
    except Exception:  # noqa: BLE001
        # Broker down or task not registered (e.g. in tests). Don't fail the
        # caller — daily_summary will catch up.
        import logging

        logging.getLogger(__name__).debug(
            "salary recompute dispatch skipped for emp=%s day=%s", employee_id, day
        )


async def check_out(
    db: AsyncSession,
    user: User,
    data: CheckInRequest,
    *,
    method: AttendanceMethod = AttendanceMethod.MOBILE_APP,
    ip_address: str | None = None,
) -> AttendanceRecord:
    emp = await _employee_for_user(db, user)
    last = await _last_record(db, emp.id)
    if not last or last.check_type != CheckType.CHECK_IN:
        raise ConflictError("attendance.no_active_check_in")

    now = datetime.now(timezone.utc)
    today = now.date()
    await _block_if_on_leave(db, emp.id, today)
    _, tpl = await _scheduled_shift(db, emp.id, today)

    overtime_minutes = 0
    is_early_leave = False
    if tpl and tpl.end_time is not None:
        scheduled_end = datetime.combine(today, tpl.end_time, tzinfo=timezone.utc)
        diff_min = (now - scheduled_end).total_seconds() / 60
        if diff_min > 0 and tpl.allow_overtime:
            overtime_minutes = int(diff_min)
        elif diff_min < 0:
            is_early_leave = True

    branch = await _resolve_branch(db, data.branch_id or emp.branch_id)
    in_geofence = _is_within_geofence(branch, data.latitude, data.longitude)
    status = AttendanceStatus.VALID if in_geofence else AttendanceStatus.SUSPICIOUS

    selfie_url = _maybe_upload_selfie(data.selfie_base64, company_id=emp.company_id)

    rec = AttendanceRecord(
        company_id=emp.company_id,
        employee_id=emp.id,
        branch_id=branch.id if branch else None,
        check_type=CheckType.CHECK_OUT,
        method=method,
        timestamp=now,
        latitude=data.latitude,
        longitude=data.longitude,
        accuracy_m=data.accuracy_m,
        selfie_url=selfie_url,
        is_late=False,
        late_minutes=0,
        is_early_leave=is_early_leave,
        overtime_minutes=overtime_minutes,
        status=status,
        ip_address=ip_address,
        notes=data.notes,
    )
    db.add(rec)
    await db.commit()
    await db.refresh(rec)
    _enqueue_salary_recompute(emp.id, today)
    if not in_geofence:
        await _notify_anomaly(
            db,
            company_id=emp.company_id,
            branch_id=emp.branch_id,
            title="Out-of-geofence check-out",
            body=f"{emp.full_name} checked out outside the branch radius.",
            payload={
                "employee_id": str(emp.id),
                "lat": data.latitude,
                "lng": data.longitude,
                "title_key": "anomaly.geofence_out.title",
                "body_key": "anomaly.geofence_out.body",
                "t_args": {"name": emp.full_name or emp.employee_code},
            },
        )
    return rec


async def _notify_anomaly(
    db: AsyncSession,
    *,
    company_id: UUID,
    title: str,
    body: str,
    payload: dict,
    branch_id: UUID | None = None,
) -> None:
    """Local helper: lazy-import the notification service so this module
    stays cheap to import in tests that don't touch the WS publisher.

    Routing: when ``branch_id`` is provided we additionally fan out to the
    branch's manager(s). The company-wide admin pool always gets the alert
    too — anomalies are critical and we don't want them swallowed by a BM
    who's offline or hasn't been assigned yet.
    """
    try:
        from app.models.notification import NotificationCategory
        from app.services import notification_service

        await notification_service.notify_company_admins(
            db,
            company_id=company_id,
            title=title,
            body=body,
            category=NotificationCategory.ANOMALY,
            payload=payload,
        )
        if branch_id is not None:
            await notification_service.notify_branch_managers(
                db,
                company_id=company_id,
                branch_id=branch_id,
                title=title,
                body=body,
                category=NotificationCategory.ANOMALY,
                payload=payload,
            )
    except Exception:  # noqa: BLE001
        import logging

        logging.getLogger(__name__).exception("anomaly notification failed")


async def today_status(db: AsyncSession, user: User) -> TodayStatus:
    emp = await _employee_for_user(db, user)
    today = datetime.now(timezone.utc).date()
    start = datetime.combine(today, time.min, tzinfo=timezone.utc)
    end = start + timedelta(days=1)

    rows = (
        await db.execute(
            select(AttendanceRecord)
            .where(
                AttendanceRecord.employee_id == emp.id,
                AttendanceRecord.timestamp >= start,
                AttendanceRecord.timestamp < end,
            )
            .order_by(AttendanceRecord.timestamp.asc())
        )
    ).scalars().all()

    last_in: datetime | None = None
    last_out: datetime | None = None
    minutes_worked = 0
    pending_in: datetime | None = None

    for r in rows:
        if r.check_type == CheckType.CHECK_IN:
            last_in = r.timestamp
            pending_in = r.timestamp
        else:
            last_out = r.timestamp
            if pending_in is not None:
                minutes_worked += int((r.timestamp - pending_in).total_seconds() // 60)
                pending_in = None

    is_working = pending_in is not None
    if is_working:
        # Count ongoing session up to "now".
        minutes_worked += int(
            (datetime.now(timezone.utc) - pending_in).total_seconds() // 60
        )

    # Surface today's approved-leave coverage so the PWA can swap the
    # check-in CTA for a "You're on leave until …" banner. Only joined to
    # leave_types when an actual hit exists, so unaffected employees don't
    # pay an extra query against the table.
    on_leave = False
    leave_type_name: str | None = None
    leave_end_date: date | None = None
    today = datetime.now(timezone.utc).date()
    from app.models.leave import LeaveRequest, LeaveStatus, LeaveType

    leave_row = (
        await db.execute(
            select(LeaveRequest, LeaveType)
            .join(LeaveType, LeaveType.id == LeaveRequest.leave_type_id)
            .where(
                LeaveRequest.employee_id == emp.id,
                LeaveRequest.status == LeaveStatus.APPROVED.value,
                LeaveRequest.start_date <= today,
                LeaveRequest.end_date >= today,
            )
            .execution_options(skip_tenant_filter=True)
            .limit(1)
        )
    ).first()
    if leave_row is not None:
        lr, lt = leave_row
        on_leave = True
        leave_type_name = lt.name
        leave_end_date = lr.end_date

    return TodayStatus(
        last_check_in=last_in,
        last_check_out=last_out,
        is_working=is_working,
        minutes_worked_today=minutes_worked,
        on_leave=on_leave,
        leave_type_name=leave_type_name,
        leave_end_date=leave_end_date,
    )


__all__ = ["check_in", "check_out", "today_status"]
