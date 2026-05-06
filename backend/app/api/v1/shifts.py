"""Shift templates + schedule (bulk monthly assignment)."""
from __future__ import annotations

from datetime import date as Date
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.deps import CurrentUser, DbDep, TenantId, require_permission
from app.core.exceptions import NotFoundError, PermissionDeniedError
from app.core.permissions import Role
from app.models.employee import Employee
from app.models.shift import ShiftSchedule, ShiftTemplate
from app.schemas.common import MessageResponse, Page
from app.schemas.shift import (
    MyShiftRow,
    ShiftScheduleBulkCreate,
    ShiftScheduleBulkResult,
    ShiftScheduleRead,
    ShiftTemplateCreate,
    ShiftTemplateRead,
    ShiftTemplateUpdate,
)

router = APIRouter(prefix="/shifts", tags=["shifts"])


def _company_id(user, tenant) -> UUID:
    cid = tenant or user.company_id
    if cid is None:
        raise PermissionDeniedError()
    return cid


# ---------- Templates ---------------------------------------------------------

@router.get(
    "/templates",
    response_model=Page[ShiftTemplateRead],
    dependencies=[Depends(require_permission("shift.read"))],
)
async def list_templates(
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
) -> Page[ShiftTemplateRead]:
    _company_id(user, tenant)
    total = (await db.execute(select(func.count(ShiftTemplate.id)))).scalar_one()
    rows = (
        await db.execute(
            select(ShiftTemplate)
            .order_by(ShiftTemplate.name)
            .offset((page - 1) * size)
            .limit(size)
        )
    ).scalars().all()
    return Page[ShiftTemplateRead](
        items=[ShiftTemplateRead.model_validate(r) for r in rows],
        total=total,
        page=page,
        size=size,
    )


@router.post(
    "/templates",
    response_model=ShiftTemplateRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("shift.create"))],
)
async def create_template(
    data: ShiftTemplateCreate,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> ShiftTemplateRead:
    company_id = _company_id(user, tenant)
    payload = data.model_dump()
    # Validate working_days [1..7] uniqueness/range
    payload["working_days"] = _normalize_working_days(payload.get("working_days"))
    tpl = ShiftTemplate(company_id=company_id, **payload)
    db.add(tpl)
    await db.commit()
    await db.refresh(tpl)
    return ShiftTemplateRead.model_validate(tpl)


def _normalize_working_days(value: list[int] | None) -> list[int]:
    if value is None:
        return [1, 2, 3, 4, 5, 6]
    cleaned = sorted({int(v) for v in value})
    if not cleaned or any(v < 1 or v > 7 for v in cleaned):
        from app.core.exceptions import ValidationAppError

        raise ValidationAppError("shift.working_days_invalid")
    return cleaned


async def _get_template(db, tpl_id: UUID) -> ShiftTemplate:
    tpl = (
        await db.execute(select(ShiftTemplate).where(ShiftTemplate.id == tpl_id))
    ).scalar_one_or_none()
    if not tpl:
        raise NotFoundError("shift.template_not_found")
    return tpl


@router.patch(
    "/templates/{tpl_id}",
    response_model=ShiftTemplateRead,
    dependencies=[Depends(require_permission("shift.update"))],
)
async def update_template(
    tpl_id: UUID,
    data: ShiftTemplateUpdate,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> ShiftTemplateRead:
    _company_id(user, tenant)
    tpl = await _get_template(db, tpl_id)
    diff = data.model_dump(exclude_unset=True)
    if "working_days" in diff:
        diff["working_days"] = _normalize_working_days(diff["working_days"])
    days_changed = (
        "working_days" in diff and list(diff["working_days"] or []) != list(tpl.working_days or [])
    )
    for f, v in diff.items():
        setattr(tpl, f, v)
    await db.commit()
    await db.refresh(tpl)

    # Fan out: every employee on this template gets their schedule
    # rewritten so the calendar lines up with the new pattern. Wrapped
    # in its own try/except so a regen failure doesn't fail the PATCH.
    if days_changed or "is_active" in diff:
        from app.services.shift_service import regenerate_for_template

        try:
            await regenerate_for_template(db, tpl.id)
            await db.commit()
        except Exception:  # pragma: no cover — defensive
            await db.rollback()
    return ShiftTemplateRead.model_validate(tpl)


@router.delete(
    "/templates/{tpl_id}",
    response_model=MessageResponse,
    dependencies=[Depends(require_permission("shift.delete"))],
)
async def delete_template(
    tpl_id: UUID,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> MessageResponse:
    _company_id(user, tenant)
    tpl = await _get_template(db, tpl_id)
    tpl.is_active = False
    await db.commit()
    return MessageResponse(message="deactivated")


# ---------- Schedule ----------------------------------------------------------

@router.post(
    "/schedule",
    response_model=ShiftScheduleBulkResult,
    dependencies=[Depends(require_permission("shift.update"))],
)
async def bulk_schedule(
    data: ShiftScheduleBulkCreate,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> ShiftScheduleBulkResult:
    """Upsert (employee_id, date) → shift assignment.

    Used by the admin UI's monthly grid: send the whole month in one call,
    we insert new rows or overwrite existing ones.
    """
    company_id = _company_id(user, tenant)

    # Count existing rows that will be overwritten so we can return a useful
    # diff to the UI.
    keys = [(e.employee_id, e.date) for e in data.entries]
    existing_q = select(func.count(ShiftSchedule.id)).where(
        ShiftSchedule.company_id == company_id,
        # tuple-IN isn't trivially expressible; instead count by a coarse
        # filter and let the upsert tell us the truth.
    )
    # Skip the overwrite count; it would require a CTE join. Return updated=0
    # for now; the UI shows the final state regardless.
    _ = existing_q  # unused — placeholder for a future, more precise count

    rows = [
        {
            "company_id": company_id,
            "employee_id": e.employee_id,
            "shift_template_id": e.shift_template_id,
            "date": e.date,
            "custom_start": e.custom_start,
            "custom_end": e.custom_end,
            "status": e.status.value,
        }
        for e in data.entries
    ]

    stmt = pg_insert(ShiftSchedule).values(rows)
    upsert_stmt = stmt.on_conflict_do_update(
        index_elements=["employee_id", "date"],
        set_={
            "shift_template_id": stmt.excluded.shift_template_id,
            "custom_start": stmt.excluded.custom_start,
            "custom_end": stmt.excluded.custom_end,
            "status": stmt.excluded.status,
        },
    )
    # The listener doesn't filter raw INSERTs, but the company_id column
    # carries the tenant explicitly so this is safe.
    await db.execute(upsert_stmt)
    await db.commit()
    return ShiftScheduleBulkResult(created=len(rows), updated=0)


@router.get(
    "/schedule",
    response_model=list[ShiftScheduleRead],
    dependencies=[Depends(require_permission("shift.read"))],
)
async def list_schedule(
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
    employee_id: UUID | None = None,
    from_date: Date | None = Query(None, alias="from"),
    to_date: Date | None = Query(None, alias="to"),
) -> list[ShiftScheduleRead]:
    _company_id(user, tenant)
    stmt = select(ShiftSchedule).order_by(ShiftSchedule.date.asc())
    # BRANCH_MANAGER: only schedule rows for employees in their branch.
    if user.role == Role.BRANCH_MANAGER and user.branch_id is not None:
        stmt = stmt.join(Employee, Employee.id == ShiftSchedule.employee_id).where(
            Employee.branch_id == user.branch_id
        )
    if employee_id is not None:
        stmt = stmt.where(ShiftSchedule.employee_id == employee_id)
    if from_date is not None:
        stmt = stmt.where(ShiftSchedule.date >= from_date)
    if to_date is not None:
        stmt = stmt.where(ShiftSchedule.date <= to_date)
    rows = (await db.execute(stmt)).scalars().all()
    return [ShiftScheduleRead.model_validate(r) for r in rows]


@router.get(
    "/me",
    response_model=list[ShiftScheduleRead],
)
async def my_schedule(
    user: CurrentUser,
    db: DbDep,
    from_date: Date | None = Query(None, alias="from"),
    to_date: Date | None = Query(None, alias="to"),
) -> list[ShiftScheduleRead]:
    """Mobile: an employee fetches their own upcoming shifts."""
    if user.role != "EMPLOYEE":
        raise PermissionDeniedError()
    from app.models.employee import Employee

    emp = (
        await db.execute(select(Employee).where(Employee.user_id == user.id))
    ).scalar_one_or_none()
    if not emp:
        raise NotFoundError("employee.not_found")

    stmt = select(ShiftSchedule).where(ShiftSchedule.employee_id == emp.id).order_by(
        ShiftSchedule.date.asc()
    )
    if from_date is not None:
        stmt = stmt.where(ShiftSchedule.date >= from_date)
    if to_date is not None:
        stmt = stmt.where(ShiftSchedule.date <= to_date)
    rows = (await db.execute(stmt)).scalars().all()
    return [ShiftScheduleRead.model_validate(r) for r in rows]


@router.get(
    "/me/upcoming",
    response_model=list[MyShiftRow],
)
async def my_upcoming_shifts(
    user: CurrentUser,
    db: DbDep,
    days: int = Query(14, ge=1, le=60),
) -> list[MyShiftRow]:
    """Mobile/PWA — denormalized upcoming schedule for the next N days.

    Returns each scheduled day with the template's name + start/end already
    resolved (custom_start/end takes priority). Saves the client one extra
    round-trip and a permission upgrade just to fetch templates.
    """
    if user.role != "EMPLOYEE":
        raise PermissionDeniedError()
    from datetime import date as Date, timedelta

    from app.models.employee import Employee

    emp = (
        await db.execute(select(Employee).where(Employee.user_id == user.id))
    ).scalar_one_or_none()
    if not emp:
        raise NotFoundError("employee.not_found")

    today = Date.today()
    until = today + timedelta(days=days)
    rows = (
        await db.execute(
            select(ShiftSchedule, ShiftTemplate)
            .join(
                ShiftTemplate,
                ShiftTemplate.id == ShiftSchedule.shift_template_id,
                isouter=True,
            )
            .where(
                ShiftSchedule.employee_id == emp.id,
                ShiftSchedule.date >= today,
                ShiftSchedule.date <= until,
            )
            .order_by(ShiftSchedule.date.asc())
        )
    ).all()

    # Approved leaves overlapping the requested window. We use these for two
    # things: (1) overlay ON_LEAVE on top of the scheduled status so a planned
    # shift falling inside a vacation reads as "On leave" rather than
    # "Planned"; (2) synthesize rows for leave days that have no schedule at
    # all (common in practice — schedules are usually planned a week out, but
    # a 21-day leave runs further). Without (2) the user would see a gap in
    # their upcoming list and might worry no one knows about their leave.
    from app.models.leave import LeaveRequest, LeaveStatus, LeaveType

    leave_rows = (
        await db.execute(
            select(LeaveRequest, LeaveType)
            .join(LeaveType, LeaveType.id == LeaveRequest.leave_type_id)
            .where(
                LeaveRequest.employee_id == emp.id,
                LeaveRequest.status == LeaveStatus.APPROVED.value,
                LeaveRequest.start_date <= until,
                LeaveRequest.end_date >= today,
            )
            .execution_options(skip_tenant_filter=True)
        )
    ).all()

    leave_by_day: dict[Date, LeaveType] = {}
    for lr, lt in leave_rows:
        cur = max(lr.start_date, today)
        end = min(lr.end_date, until)
        while cur <= end:
            leave_by_day[cur] = lt
            cur += timedelta(days=1)

    scheduled_days = {sched.date for sched, _tpl in rows}

    out: list[MyShiftRow] = []
    for sched, tpl in rows:
        leave_lt = leave_by_day.get(sched.date)
        status = "ON_LEAVE" if leave_lt is not None else sched.status
        out.append(
            MyShiftRow(
                id=sched.id,
                date=sched.date,
                status=status,
                template_name=(
                    leave_lt.name if leave_lt is not None else (tpl.name if tpl else None)
                ),
                template_type=tpl.type if tpl else None,
                start_time=sched.custom_start
                or (tpl.start_time if tpl else None),
                end_time=sched.custom_end or (tpl.end_time if tpl else None),
                break_minutes=tpl.break_minutes if tpl else None,
                expected_hours=tpl.expected_hours if tpl else None,
            )
        )

    # Synthetic rows for leave days that have no ShiftSchedule. UUIDs are
    # generated on the fly — they're stable within a single response but
    # have no DB row, which is fine: the PWA only needs an id for React keys.
    import uuid as _uuid

    for day, lt in leave_by_day.items():
        if day in scheduled_days:
            continue
        out.append(
            MyShiftRow(
                id=_uuid.uuid4(),
                date=day,
                status="ON_LEAVE",
                template_name=lt.name,
                template_type=None,
                start_time=None,
                end_time=None,
                break_minutes=None,
                expected_hours=None,
            )
        )

    out.sort(key=lambda r: r.date)
    return out
