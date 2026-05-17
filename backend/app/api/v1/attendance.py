"""Attendance endpoints — mobile (employee), admin (read/manual), webhook (Phase 4)."""
from __future__ import annotations

from datetime import date as Date
from datetime import datetime, time, timedelta, timezone
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import desc, func, select

from app.config import settings as _app_settings
from app.core.deps import (
    CurrentUser,
    DbDep,
    TenantId,
    apply_branch_scope,
    client_ip,
    require_permission,
)
from app.core.exceptions import NotFoundError, PermissionDeniedError
from app.core.permissions import Role
from app.models.attendance import (
    AttendanceMethod,
    AttendanceRecord,
    AttendanceStatus,
    CheckType,
)
from app.models.branch import Branch
from app.models.company import Company
from app.models.employee import Employee
from app.models.leave import LeaveRequest, LeaveStatus
from app.models.shift import ScheduleStatus, ShiftSchedule
from app.schemas.attendance import (
    AttendanceRead,
    AttendanceUpdate,
    CheckInRequest,
    CheckOutRequest,
    DailyOverviewRow,
    ManualAttendance,
    MonthlyOverviewRow,
    TodayStatus,
)
from app.schemas.common import MessageResponse, Page
from app.services import attendance_service, audit_service

router = APIRouter(prefix="/attendance", tags=["attendance"])


def _company_id(user, tenant) -> UUID:
    cid = tenant or user.company_id
    if cid is None:
        raise PermissionDeniedError()
    return cid


# ---------- Mobile (employee) ------------------------------------------------

@router.post("/check-in", response_model=AttendanceRead)
async def check_in(
    data: CheckInRequest,
    user: CurrentUser,
    db: DbDep,
    ip: str | None = Depends(client_ip),
) -> AttendanceRead:
    if user.role != Role.EMPLOYEE:
        raise PermissionDeniedError()
    rec = await attendance_service.check_in(db, user, data, ip_address=ip)
    return AttendanceRead.model_validate(rec)


@router.post("/check-out", response_model=AttendanceRead)
async def check_out(
    data: CheckOutRequest,
    user: CurrentUser,
    db: DbDep,
    ip: str | None = Depends(client_ip),
) -> AttendanceRead:
    if user.role != Role.EMPLOYEE:
        raise PermissionDeniedError()
    rec = await attendance_service.check_out(db, user, data, ip_address=ip)
    return AttendanceRead.model_validate(rec)


@router.get("/today", response_model=TodayStatus)
async def today(user: CurrentUser, db: DbDep) -> TodayStatus:
    if user.role != Role.EMPLOYEE:
        raise PermissionDeniedError()
    return await attendance_service.today_status(db, user)


@router.get("/history", response_model=list[AttendanceRead])
async def my_history(
    user: CurrentUser,
    db: DbDep,
    from_date: Date | None = Query(None, alias="from"),
    to_date: Date | None = Query(None, alias="to"),
    limit: int = Query(100, ge=1, le=500),
) -> list[AttendanceRead]:
    if user.role != Role.EMPLOYEE:
        raise PermissionDeniedError()
    emp = (
        await db.execute(select(Employee).where(Employee.user_id == user.id))
    ).scalar_one_or_none()
    if not emp:
        raise NotFoundError("employee.not_found")

    stmt = (
        select(AttendanceRecord)
        .where(AttendanceRecord.employee_id == emp.id)
        .order_by(desc(AttendanceRecord.timestamp))
        .limit(limit)
    )
    if from_date:
        stmt = stmt.where(AttendanceRecord.timestamp >= datetime.combine(from_date, datetime.min.time()))
    if to_date:
        stmt = stmt.where(AttendanceRecord.timestamp <= datetime.combine(to_date, datetime.max.time()))
    rows = (await db.execute(stmt)).scalars().all()
    return [AttendanceRead.model_validate(r) for r in rows]


# ---------- Admin -----------------------------------------------------------


def _attach_geofence_diag(rec: AttendanceRecord) -> AttendanceRead:
    """Plain ORM → schema; the geofence fields stay None until
    ``_hydrate_geofence`` fills them in batch."""
    return AttendanceRead.model_validate(rec)


async def _hydrate_geofence(
    db, items: list[AttendanceRead], rows: list[AttendanceRecord]
) -> None:
    """Populate ``branch_name`` / ``branch_geofence_radius_m`` /
    ``distance_from_branch_m`` / ``within_geofence`` on every record
    that has a ``branch_id`` + GPS coords. Single batched lookup keeps
    a 200-row records page from N+1'ing the branches table."""
    from app.services.attendance_service import (
        _haversine_m,
        _is_within_geofence,
    )

    branch_ids: set[UUID] = {
        r.branch_id for r in rows if r.branch_id is not None
    }
    if not branch_ids:
        return
    branches = (
        await db.execute(select(Branch).where(Branch.id.in_(branch_ids)))
    ).scalars().all()
    by_id: dict[UUID, Branch] = {b.id: b for b in branches}

    for item, rec in zip(items, rows):
        b = by_id.get(rec.branch_id) if rec.branch_id else None
        if b is None:
            continue
        item.branch_name = b.name
        if b.geofence_radius_m is not None:
            item.branch_geofence_radius_m = float(b.geofence_radius_m)
        if (
            rec.latitude is not None
            and rec.longitude is not None
            and b.latitude is not None
            and b.longitude is not None
        ):
            dist = _haversine_m(
                b.latitude, b.longitude, rec.latitude, rec.longitude
            )
            item.distance_from_branch_m = round(dist, 1)
            item.within_geofence = _is_within_geofence(
                b, rec.latitude, rec.longitude
            )


@router.get(
    "/records",
    response_model=Page[AttendanceRead],
    dependencies=[Depends(require_permission("attendance.read"))],
)
async def list_records(
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
    employee_id: UUID | None = None,
    branch_id: UUID | None = None,
    from_date: Date | None = Query(None, alias="from"),
    to_date: Date | None = Query(None, alias="to"),
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
) -> Page[AttendanceRead]:
    _company_id(user, tenant)
    stmt = select(AttendanceRecord)
    count_stmt = select(func.count(AttendanceRecord.id))
    if employee_id:
        stmt = stmt.where(AttendanceRecord.employee_id == employee_id)
        count_stmt = count_stmt.where(AttendanceRecord.employee_id == employee_id)
    if branch_id:
        stmt = stmt.where(AttendanceRecord.branch_id == branch_id)
        count_stmt = count_stmt.where(AttendanceRecord.branch_id == branch_id)
    if from_date:
        ts = datetime.combine(from_date, datetime.min.time())
        stmt = stmt.where(AttendanceRecord.timestamp >= ts)
        count_stmt = count_stmt.where(AttendanceRecord.timestamp >= ts)
    if to_date:
        ts = datetime.combine(to_date, datetime.max.time())
        stmt = stmt.where(AttendanceRecord.timestamp <= ts)
        count_stmt = count_stmt.where(AttendanceRecord.timestamp <= ts)

    total = (await db.execute(count_stmt)).scalar_one()
    rows = (
        await db.execute(
            stmt.order_by(desc(AttendanceRecord.timestamp))
            .offset((page - 1) * size)
            .limit(size)
        )
    ).scalars().all()
    items = [_attach_geofence_diag(r) for r in rows]
    # Populate geofence diagnostics in a single batched branch lookup
    # so the per-record fields (distance_from_branch_m, branch_name,
    # within_geofence) can render in the UI without N+1 queries.
    await _hydrate_geofence(db, items, rows)
    return Page[AttendanceRead](
        items=items,
        total=total,
        page=page,
        size=size,
    )


@router.post(
    "/manual",
    response_model=AttendanceRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("attendance.create"))],
)
async def manual_record(
    data: ManualAttendance,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
    ip: str | None = Depends(client_ip),
) -> AttendanceRead:
    """Admin enters an attendance row by hand (e.g. when device was offline).

    No geofence/late check is applied — the admin is asserting the truth.
    """
    company_id = _company_id(user, tenant)
    emp = (
        await db.execute(select(Employee).where(Employee.id == data.employee_id))
    ).scalar_one_or_none()
    if not emp:
        raise NotFoundError("employee.not_found")

    rec = AttendanceRecord(
        company_id=company_id,
        employee_id=emp.id,
        branch_id=data.branch_id or emp.branch_id,
        check_type=data.check_type,
        method=AttendanceMethod.MANUAL,
        timestamp=data.timestamp,
        notes=data.notes,
        ip_address=ip,
    )
    db.add(rec)
    await db.commit()
    await db.refresh(rec)
    await audit_service.record(
        db,
        action="attendance.manual",
        actor_id=user.id,
        actor_role=user.role,
        company_id=company_id,
        resource_type="attendance",
        resource_id=rec.id,
        commit=True,
    )
    return AttendanceRead.model_validate(rec)


@router.patch(
    "/records/{record_id}",
    response_model=AttendanceRead,
    dependencies=[Depends(require_permission("attendance.update"))],
)
async def update_record(
    record_id: UUID,
    data: AttendanceUpdate,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> AttendanceRead:
    """Admin patches a single record. Only ``status`` and ``notes`` are
    editable — timestamp / check_type / employee_id stay immutable so payroll
    runs against the original audit trail."""
    _company_id(user, tenant)
    rec = (
        await db.execute(select(AttendanceRecord).where(AttendanceRecord.id == record_id))
    ).scalar_one_or_none()
    if not rec:
        raise NotFoundError("attendance.record_not_found")
    payload = data.model_dump(exclude_unset=True)
    for f, v in payload.items():
        setattr(rec, f, v)
    await db.commit()
    await db.refresh(rec)
    await audit_service.record(
        db,
        action="attendance.update",
        actor_id=user.id,
        actor_role=user.role,
        company_id=rec.company_id,
        resource_type="attendance",
        resource_id=rec.id,
        payload=payload,
        commit=True,
    )
    return AttendanceRead.model_validate(rec)


@router.delete(
    "/records/{record_id}",
    response_model=MessageResponse,
    dependencies=[Depends(require_permission("attendance.update"))],
)
async def reject_record(
    record_id: UUID,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
    hard: bool = False,
) -> MessageResponse:
    """Reject (soft-default) or hard-delete an attendance record.

    Default: ``status = REJECTED`` so payroll skips it but the audit
    trail keeps a row.

    ``?hard=true``: row is fully removed. Use for kiosk mis-fires / bad
    test data the customer doesn't want lingering in their reports.
    The audit log still gets a ``attendance.delete`` event with the
    snapshotted employee/timestamp/method so the action is traceable
    even after the underlying row is gone.
    """
    _company_id(user, tenant)
    rec = (
        await db.execute(select(AttendanceRecord).where(AttendanceRecord.id == record_id))
    ).scalar_one_or_none()
    if not rec:
        raise NotFoundError("attendance.record_not_found")

    if hard:
        snapshot = {
            "employee_id": str(rec.employee_id),
            "timestamp": rec.timestamp.isoformat() if rec.timestamp else None,
            "method": rec.method.value if hasattr(rec.method, "value") else str(rec.method),
            "check_type": rec.check_type.value if hasattr(rec.check_type, "value") else str(rec.check_type),
        }
        await db.delete(rec)
        await db.commit()
        await audit_service.record(
            db,
            action="attendance.delete",
            actor_id=user.id,
            actor_role=user.role,
            company_id=rec.company_id,
            resource_type="attendance",
            resource_id=record_id,
            payload=snapshot,
            commit=True,
        )
        return MessageResponse(message="deleted")

    rec.status = AttendanceStatus.REJECTED
    await db.commit()
    await audit_service.record(
        db,
        action="attendance.reject",
        actor_id=user.id,
        actor_role=user.role,
        company_id=rec.company_id,
        resource_type="attendance",
        resource_id=rec.id,
        commit=True,
    )
    return MessageResponse(message="rejected")


# ---------- Aggregate views ---------------------------------------------------


_TZ_LOCAL = ZoneInfo(_app_settings.tz)


def _day_bounds(day: Date) -> tuple[datetime, datetime]:
    """Local-day window expressed as UTC datetimes for SQL comparisons.

    Records' ``timestamp`` column is timezone-aware UTC. The admin Live
    tab + Records tab treat "today" as a Tashkent-local day; a UTC
    window would split off the early-morning local hours (00:00–04:59
    local = previous UTC day) into the wrong bucket. Mirrors what
    /attendance/today on the PWA side now does after the same fix.
    """
    start_local = datetime.combine(day, time.min, tzinfo=_TZ_LOCAL)
    end_local = start_local + timedelta(days=1)
    return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)


@router.get(
    "/daily-overview",
    response_model=list[DailyOverviewRow],
    dependencies=[Depends(require_permission("attendance.read"))],
)
async def daily_overview(
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
    target: Date | None = Query(None, alias="date"),
    branch_id: UUID | None = None,
) -> list[DailyOverviewRow]:
    """One row per active employee with their attendance shape for ``date``.

    Used by the admin ``Live`` tab. Computes worked-minutes by pairing
    chronologically-ordered check-ins/check-outs; an unpaired tail check-in
    means the employee is currently inside.
    """
    company_id = _company_id(user, tenant)
    # Use Tashkent-local "today" as the default — matches what the
    # admin sees on the dashboard wall-clock and what _day_bounds()
    # now uses for the SQL window. Without this, the page loaded at
    # 02:00 local would default to *yesterday's* date and hide every
    # check-in posted between 00:00–04:59 local time.
    day = target or datetime.now(_TZ_LOCAL).date()
    start, end = _day_bounds(day)

    emp_stmt = apply_branch_scope(
        select(Employee).where(Employee.is_active.is_(True)),
        user,
        Employee.branch_id,
    )
    if branch_id is not None:
        emp_stmt = emp_stmt.where(Employee.branch_id == branch_id)
    employees = (await db.execute(emp_stmt)).scalars().all()

    # Pull all of today's records (non-rejected) in one query, group by employee.
    recs = (
        await db.execute(
            select(AttendanceRecord)
            .where(
                AttendanceRecord.timestamp >= start,
                AttendanceRecord.timestamp < end,
                AttendanceRecord.status != AttendanceStatus.REJECTED,
            )
            .order_by(AttendanceRecord.timestamp.asc())
        )
    ).scalars().all()
    by_emp: dict[UUID, list[AttendanceRecord]] = {}
    for r in recs:
        by_emp.setdefault(r.employee_id, []).append(r)

    # Schedule rows for the day so we can compute REST_DAY etc.
    sched_rows = (
        await db.execute(
            select(ShiftSchedule).where(ShiftSchedule.date == day)
        )
    ).scalars().all()
    sched_by_emp: dict[UUID, ShiftSchedule] = {s.employee_id: s for s in sched_rows}

    # Templates the employees are pinned to. Needed so we can compute
    # ``late_min`` on the fly from ``first_in`` vs ``template.start_time``
    # — relying on AttendanceRecord.late_minutes alone breaks when the
    # check-in happened before a schedule existed for the day, leaving
    # the stored value at 0.
    template_ids: set[UUID] = set()
    for s in sched_rows:
        if s.shift_template_id:
            template_ids.add(s.shift_template_id)
    for e in employees:
        if e.shift_template_id:
            template_ids.add(e.shift_template_id)
    template_by_id: dict[UUID, "ShiftTemplate"] = {}
    if template_ids:
        from app.models.shift import ShiftTemplate

        tpl_rows = (
            await db.execute(
                select(ShiftTemplate).where(ShiftTemplate.id.in_(template_ids))
            )
        ).scalars().all()
        template_by_id = {t.id: t for t in tpl_rows}

    # Approved leaves overlapping the day. Used to surface ON_LEAVE on the
    # Live overview regardless of whether the employee checked in — a paid
    # vacation should never look like an ABSENCE on the dashboard.
    leave_rows = (
        await db.execute(
            select(LeaveRequest.employee_id).where(
                LeaveRequest.status == LeaveStatus.APPROVED.value,
                LeaveRequest.start_date <= day,
                LeaveRequest.end_date >= day,
            )
        )
    ).scalars().all()
    on_leave: set[UUID] = set(leave_rows)

    # Company.working_days for ABSENT detection on weekdays without a schedule.
    company = (
        await db.execute(
            select(Company)
            .where(Company.id == company_id)
            .execution_options(skip_tenant_filter=True)
        )
    ).scalar_one()
    working_days = company.settings.get("working_days", [1, 2, 3, 4, 5])
    if not isinstance(working_days, list):
        working_days = [1, 2, 3, 4, 5]
    is_workday = day.isoweekday() in working_days
    now = datetime.now(timezone.utc)

    out: list[DailyOverviewRow] = []
    for emp in employees:
        emp_recs = by_emp.get(emp.id, [])
        sched = sched_by_emp.get(emp.id)

        # Pair check-ins / outs to compute worked minutes. The last item being
        # a CHECK_IN with no following CHECK_OUT means "currently in" — for
        # the admin Live view we count the ongoing leg up to ``now`` so the
        # number ticks toward "real" worked time.
        worked_min = 0
        first_in: datetime | None = None
        first_in_late_min = 0
        last_out: datetime | None = None
        ot_min = 0
        pending_in: AttendanceRecord | None = None
        for r in emp_recs:
            if r.check_type == CheckType.CHECK_IN:
                if first_in is None:
                    first_in = r.timestamp
                    # Lateness is only meaningful for the FIRST check-in
                    # of the day. Re-entries after a lunch break would
                    # otherwise be measured against the original shift
                    # start and read as "10 hours late" — nonsense.
                    first_in_late_min = int(r.late_minutes or 0)
                pending_in = r
            else:  # CHECK_OUT
                last_out = r.timestamp
                ot_min += int(r.overtime_minutes or 0)
                if pending_in is not None:
                    delta = (r.timestamp - pending_in.timestamp).total_seconds() / 60
                    if delta > 0:
                        worked_min += int(delta)
                    pending_in = None
        late_min = first_in_late_min
        is_in = pending_in is not None
        if is_in and pending_in is not None:
            ongoing = (now - pending_in.timestamp).total_seconds() / 60
            if ongoing > 0:
                worked_min += int(ongoing)

        # Cross-check the recorded late_min against (first_in vs template).
        # The check-in record's stored ``late_minutes`` is 0 when the
        # employee checked in before today's ShiftSchedule existed (a
        # bootstrapping window). Recompute on the fly using the schedule's
        # template if available, falling back to the employee's default
        # template assignment. Whichever is larger wins so we never under-
        # report tardiness.
        effective_tpl = None
        if sched and sched.shift_template_id:
            effective_tpl = template_by_id.get(sched.shift_template_id)
        if effective_tpl is None and emp.shift_template_id:
            effective_tpl = template_by_id.get(emp.shift_template_id)
        if first_in is not None and effective_tpl and effective_tpl.start_time:
            # ShiftTemplate.start_time is wall-clock Tashkent local —
            # comparing it to first_in (UTC) without converting was
            # showing 5-hour false "lateness". Anchor the scheduled
            # instant in TZ_LOCAL, then compare against UTC.
            scheduled_dt = datetime.combine(
                day, effective_tpl.start_time, tzinfo=_TZ_LOCAL
            ).astimezone(timezone.utc)
            diff = int((first_in - scheduled_dt).total_seconds() // 60)
            if diff > late_min:
                late_min = max(0, diff)

        # Status decision tree.
        #
        # Order matters: an approved leave overrides everything else (the
        # employee is contractually allowed to be away today, so they must
        # not show up as ABSENT/LATE/PRESENT). Rest day comes next, and only
        # then do we look at actual attendance signals. LATE wins over
        # IN_PROGRESS because a 17:31 check-in on a 9-18 shift is far more
        # informative than "currently in".
        if emp.id in on_leave:
            status_label = "ON_LEAVE"
        elif sched and sched.status == ScheduleStatus.REST_DAY.value:
            status_label = "REST_DAY"
        elif first_in is not None and late_min > 0:
            status_label = "LATE"
        elif is_in:
            status_label = "IN_PROGRESS"
        elif first_in is None:
            # No check-in. ABSENT if the employee was expected today —
            # either the company-wide working_days flag is set, OR the
            # employee has a planned/swapped shift on this date. Cancelled
            # schedules and non-workday weekends with no shift fall through
            # to NOT_SCHEDULED ("smenasi yo'q").
            has_planned_shift = (
                sched is not None
                and sched.status
                in (
                    ScheduleStatus.PLANNED.value,
                    ScheduleStatus.SWAPPED.value,
                )
            )
            if (is_workday or has_planned_shift) and day <= now.date():
                status_label = "ABSENT"
            else:
                status_label = "NOT_SCHEDULED"
        else:
            status_label = "PRESENT"

        out.append(
            DailyOverviewRow(
                employee_id=emp.id,
                employee_code=emp.employee_code,
                full_name=emp.full_name,
                photo_url=emp.photo_url,
                branch_id=emp.branch_id,
                department_id=emp.department_id,
                position=emp.position,
                first_check_in=first_in,
                last_check_out=last_out,
                is_currently_in=is_in,
                minutes_worked=worked_min,
                late_minutes=late_min,
                overtime_minutes=ot_min,
                shift_status=status_label,
            )
        )
    # Sort: in-progress first, then late, then present, then absent, then rest.
    order = {
        "IN_PROGRESS": 0,
        "LATE": 1,
        "PRESENT": 2,
        "ABSENT": 3,
        "ON_LEAVE": 4,
        "REST_DAY": 5,
        "NOT_SCHEDULED": 6,
    }
    out.sort(key=lambda r: (order.get(r.shift_status, 9), r.full_name))
    return out


@router.get(
    "/monthly-overview",
    response_model=list[MonthlyOverviewRow],
    dependencies=[Depends(require_permission("attendance.read"))],
)
async def monthly_overview(
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
    branch_id: UUID | None = None,
) -> list[MonthlyOverviewRow]:
    """Per-employee aggregate for the given calendar month — what payroll
    review and the manager dashboard need."""
    company_id = _company_id(user, tenant)
    month_start = Date(year, month, 1)
    if month == 12:
        month_end_excl = Date(year + 1, 1, 1)
    else:
        month_end_excl = Date(year, month + 1, 1)
    start_dt = datetime.combine(month_start, time.min, tzinfo=timezone.utc)
    end_dt = datetime.combine(month_end_excl, time.min, tzinfo=timezone.utc)

    emp_stmt = apply_branch_scope(
        select(Employee).where(Employee.is_active.is_(True)),
        user,
        Employee.branch_id,
    )
    if branch_id is not None:
        emp_stmt = emp_stmt.where(Employee.branch_id == branch_id)
    employees = (await db.execute(emp_stmt)).scalars().all()

    recs = (
        await db.execute(
            select(AttendanceRecord)
            .where(
                AttendanceRecord.timestamp >= start_dt,
                AttendanceRecord.timestamp < end_dt,
                AttendanceRecord.status != AttendanceStatus.REJECTED,
            )
            .order_by(AttendanceRecord.timestamp.asc())
        )
    ).scalars().all()

    by_emp_day: dict[tuple[UUID, Date], list[AttendanceRecord]] = {}
    for r in recs:
        key = (r.employee_id, r.timestamp.astimezone(timezone.utc).date())
        by_emp_day.setdefault(key, []).append(r)

    sched_rows = (
        await db.execute(
            select(ShiftSchedule).where(
                ShiftSchedule.date >= month_start,
                ShiftSchedule.date < month_end_excl,
            )
        )
    ).scalars().all()
    rest_per_emp: dict[UUID, int] = {}
    for s in sched_rows:
        if s.status == ScheduleStatus.REST_DAY.value or s.status == ScheduleStatus.REST_DAY:
            rest_per_emp[s.employee_id] = rest_per_emp.get(s.employee_id, 0) + 1

    company = (
        await db.execute(
            select(Company)
            .where(Company.id == company_id)
            .execution_options(skip_tenant_filter=True)
        )
    ).scalar_one()
    working_days_setting = company.settings.get("working_days", [1, 2, 3, 4, 5])
    if not isinstance(working_days_setting, list):
        working_days_setting = [1, 2, 3, 4, 5]
    # Local "today" so a Tashkent admin viewing the monthly report
    # between 19:00 UTC (00:00 local) and 19:00 UTC of the next day
    # sees the correct workday count for the day they actually see on
    # the clock.
    today = datetime.now(_TZ_LOCAL).date()

    # Workdays in the month (only past or today — we don't pre-flag future
    # absences).
    workday_dates: list[Date] = []
    cur = month_start
    while cur < month_end_excl and cur <= today:
        if cur.isoweekday() in working_days_setting:
            workday_dates.append(cur)
        cur += timedelta(days=1)

    out: list[MonthlyOverviewRow] = []
    for emp in employees:
        days_with_work: set[Date] = set()
        total_min = 0
        late_min = 0
        ot_min = 0
        for d in workday_dates:
            recs_d = by_emp_day.get((emp.id, d), [])
            if not recs_d:
                continue
            pending_in: AttendanceRecord | None = None
            had_in = False
            for r in recs_d:
                if r.check_type == CheckType.CHECK_IN:
                    pending_in = r
                    had_in = True
                    late_min += int(r.late_minutes or 0)
                else:
                    ot_min += int(r.overtime_minutes or 0)
                    if pending_in is not None:
                        delta = (r.timestamp - pending_in.timestamp).total_seconds() / 60
                        if delta > 0:
                            total_min += int(delta)
                        pending_in = None
            if had_in:
                days_with_work.add(d)

        rest_planned = rest_per_emp.get(emp.id, 0)
        # Absences = workdays so far without a check-in AND without a planned rest.
        absences = 0
        for d in workday_dates:
            if (emp.id, d) in by_emp_day:
                continue
            sched = next(
                (s for s in sched_rows if s.employee_id == emp.id and s.date == d),
                None,
            )
            if sched and sched.status in (ScheduleStatus.REST_DAY.value, ScheduleStatus.REST_DAY):
                continue
            absences += 1

        out.append(
            MonthlyOverviewRow(
                employee_id=emp.id,
                employee_code=emp.employee_code,
                full_name=emp.full_name,
                photo_url=emp.photo_url,
                branch_id=emp.branch_id,
                days_worked=len(days_with_work),
                total_minutes=total_min,
                late_minutes=late_min,
                overtime_minutes=ot_min,
                rest_days_planned=rest_planned,
                absence_days=absences,
            )
        )
    out.sort(key=lambda r: r.full_name)
    return out
