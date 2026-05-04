"""Leave types + leave requests."""
from __future__ import annotations

from datetime import date as Date
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import and_, desc, func, or_, select

from app.core.deps import CurrentUser, DbDep, TenantId, require_permission
from app.core.exceptions import (
    NotFoundError,
    PermissionDeniedError,
    ValidationAppError,
)
from app.core.permissions import Role
from app.models.employee import Employee
from app.models.leave import LeaveAdjustment, LeaveRequest, LeaveStatus, LeaveType
from app.schemas.common import MessageResponse
from app.schemas.leave import (
    AdminLeaveRequestCreate,
    LeaveAdjustmentCreate,
    LeaveAdjustmentRead,
    LeaveBalanceRow,
    LeaveDecision,
    LeaveRequestCreate,
    LeaveRequestRead,
    LeaveRequestUpdate,
    LeaveTypeCreate,
    LeaveTypeRead,
)
from app.services import audit_service

router = APIRouter(tags=["leaves"])


def _company_id(user, tenant) -> UUID:
    cid = tenant or user.company_id
    if cid is None:
        raise PermissionDeniedError()
    return cid


# ---------- Leave types -----------------------------------------------------

@router.get(
    "/leave-types",
    response_model=list[LeaveTypeRead],
    dependencies=[Depends(require_permission("leave.read"))],
)
async def list_leave_types(
    user: CurrentUser, db: DbDep, tenant: TenantId
) -> list[LeaveTypeRead]:
    _company_id(user, tenant)
    rows = (await db.execute(select(LeaveType).order_by(LeaveType.name))).scalars().all()
    return [LeaveTypeRead.model_validate(r) for r in rows]


@router.post(
    "/leave-types",
    response_model=LeaveTypeRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("leave.create"))],
)
async def create_leave_type(
    data: LeaveTypeCreate,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> LeaveTypeRead:
    company_id = _company_id(user, tenant)
    lt = LeaveType(company_id=company_id, **data.model_dump())
    db.add(lt)
    await db.commit()
    await db.refresh(lt)
    return LeaveTypeRead.model_validate(lt)


@router.patch(
    "/leave-types/{type_id}",
    response_model=LeaveTypeRead,
    dependencies=[Depends(require_permission("leave.update"))],
)
async def update_leave_type(
    type_id: UUID,
    data: LeaveTypeCreate,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> LeaveTypeRead:
    _company_id(user, tenant)
    lt = (
        await db.execute(select(LeaveType).where(LeaveType.id == type_id))
    ).scalar_one_or_none()
    if not lt:
        raise NotFoundError("leave.type_not_found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(lt, field, value)
    await db.commit()
    await db.refresh(lt)
    return LeaveTypeRead.model_validate(lt)


@router.delete(
    "/leave-types/{type_id}",
    response_model=MessageResponse,
    dependencies=[Depends(require_permission("leave.delete"))],
)
async def delete_leave_type(
    type_id: UUID,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> MessageResponse:
    _company_id(user, tenant)
    lt = (
        await db.execute(select(LeaveType).where(LeaveType.id == type_id))
    ).scalar_one_or_none()
    if not lt:
        raise NotFoundError("leave.type_not_found")
    lt.is_active = False
    await db.commit()
    return MessageResponse(message="deactivated")


# ---------- Leave requests --------------------------------------------------

@router.post(
    "/leave-requests",
    response_model=LeaveRequestRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_leave_request(
    data: LeaveRequestCreate,
    user: CurrentUser,
    db: DbDep,
) -> LeaveRequestRead:
    """Self-service: an EMPLOYEE submits a request for themselves."""
    if user.role != Role.EMPLOYEE:
        raise PermissionDeniedError()
    emp = (
        await db.execute(select(Employee).where(Employee.user_id == user.id))
    ).scalar_one_or_none()
    if not emp:
        raise NotFoundError("employee.not_found")

    overlap = await _find_overlap(db, emp.id, data.start_date, data.end_date)
    if overlap is not None:
        _raise_overlap(overlap)

    days = (data.end_date - data.start_date).days + 1
    request = LeaveRequest(
        company_id=emp.company_id,
        employee_id=emp.id,
        leave_type_id=data.leave_type_id,
        start_date=data.start_date,
        end_date=data.end_date,
        days=days,
        reason=data.reason,
        document_url=data.document_url,
        status=LeaveStatus.PENDING,
    )
    db.add(request)
    await db.commit()
    await db.refresh(request)

    # Route the alert to the employee's branch manager (if any). If no BM is
    # assigned to that branch, fall back to the company-wide admin pool so
    # the request doesn't sit in limbo.
    try:
        from app.models.notification import NotificationCategory
        from app.services import notification_service

        leave_payload = {
            "leave_request_id": str(request.id),
            "employee_id": str(emp.id),
            "title_key": "leave.new_request.title",
            "body_key": "leave.new_request.body",
            "t_args": {
                "name": emp.full_name or emp.employee_code,
                "start": data.start_date.isoformat(),
                "end": data.end_date.isoformat(),
                "days": days,
            },
        }
        body_text = (
            f"{data.start_date.isoformat()} → {data.end_date.isoformat()} "
            f"({days} days)"
        )
        notified = 0
        if emp.branch_id is not None:
            notified = await notification_service.notify_branch_managers(
                db,
                company_id=emp.company_id,
                branch_id=emp.branch_id,
                title=f"New leave request: {emp.full_name}",
                body=body_text,
                category=NotificationCategory.LEAVE,
                payload=leave_payload,
            )
        if notified == 0:
            await notification_service.notify_company_admins(
                db,
                company_id=emp.company_id,
                title=f"New leave request: {emp.full_name}",
                body=body_text,
                category=NotificationCategory.LEAVE,
                payload=leave_payload,
            )
    except Exception:  # noqa: BLE001
        import logging

        logging.getLogger(__name__).exception(
            "leave-request notification failed"
        )

    return LeaveRequestRead.model_validate(request)


@router.get("/leave-requests/me", response_model=list[LeaveRequestRead])
async def my_leave_requests(user: CurrentUser, db: DbDep) -> list[LeaveRequestRead]:
    if user.role != Role.EMPLOYEE:
        raise PermissionDeniedError()
    emp = (
        await db.execute(select(Employee).where(Employee.user_id == user.id))
    ).scalar_one_or_none()
    if not emp:
        raise NotFoundError("employee.not_found")
    rows = (
        await db.execute(
            select(LeaveRequest)
            .where(LeaveRequest.employee_id == emp.id)
            .order_by(desc(LeaveRequest.created_at))
        )
    ).scalars().all()
    return [LeaveRequestRead.model_validate(r) for r in rows]


@router.get(
    "/leave-requests",
    response_model=list[LeaveRequestRead],
    dependencies=[Depends(require_permission("leave.read"))],
)
async def list_leave_requests(
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
    status_filter: LeaveStatus | None = Query(None, alias="status"),
    employee_id: UUID | None = None,
) -> list[LeaveRequestRead]:
    _company_id(user, tenant)
    # BRANCH_MANAGER: only show requests filed by employees in their own
    # branch. We join through Employee to use its ``branch_id`` since
    # LeaveRequest itself doesn't carry one.
    stmt = select(LeaveRequest).order_by(desc(LeaveRequest.created_at))
    if user.role == Role.BRANCH_MANAGER and user.branch_id is not None:
        stmt = stmt.join(Employee, Employee.id == LeaveRequest.employee_id).where(
            Employee.branch_id == user.branch_id
        )
    if status_filter:
        stmt = stmt.where(LeaveRequest.status == status_filter)
    if employee_id:
        stmt = stmt.where(LeaveRequest.employee_id == employee_id)
    rows = (await db.execute(stmt)).scalars().all()
    return [LeaveRequestRead.model_validate(r) for r in rows]


@router.post(
    "/leave-requests/{request_id}/decision",
    response_model=LeaveRequestRead,
    dependencies=[Depends(require_permission("leave.update"))],
)
async def decide_leave(
    request_id: UUID,
    data: LeaveDecision,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> LeaveRequestRead:
    _company_id(user, tenant)
    if data.status not in (LeaveStatus.APPROVED, LeaveStatus.REJECTED):
        raise ValidationAppError("leave.invalid_decision")

    req = (
        await db.execute(select(LeaveRequest).where(LeaveRequest.id == request_id))
    ).scalar_one_or_none()
    if not req:
        raise NotFoundError("leave.request_not_found")
    if req.status != LeaveStatus.PENDING:
        raise ValidationAppError("leave.already_decided")

    # Branch isolation: a BRANCH_MANAGER may only decide on requests filed
    # by employees in their own branch. We hide the existence of the row
    # (NotFound) rather than 403 to avoid leaking that some out-of-scope
    # request exists.
    if user.role == Role.BRANCH_MANAGER and user.branch_id is not None:
        emp = (
            await db.execute(
                select(Employee).where(Employee.id == req.employee_id)
            )
        ).scalar_one_or_none()
        if not emp or emp.branch_id != user.branch_id:
            raise NotFoundError("leave.request_not_found")

    req.status = data.status
    req.approved_by = user.id
    req.approved_at = datetime.now(timezone.utc)
    req.decision_note = data.decision_note
    await db.commit()
    await db.refresh(req)

    await audit_service.record(
        db,
        action="leave.decision",
        actor_id=user.id,
        actor_role=user.role,
        company_id=user.company_id,
        resource_type="leave_request",
        resource_id=req.id,
        payload={"status": data.status.value},
        commit=True,
    )

    # Approval flips the days from "absent" → "on leave" in payroll: paid
    # leaves accrue, unpaid suppress absence deductions. Recompute now so
    # the EmployeeEdit Live tile reflects the change instantly.
    if data.status == LeaveStatus.APPROVED:
        await _trigger_salary_recompute(req.employee_id, req.start_date, req.end_date)

    # Push WS update to the employee (if they have a login user).
    try:
        from app.services.ws_publisher import publish_leave_status_changed

        emp = (
            await db.execute(select(Employee).where(Employee.id == req.employee_id))
        ).scalar_one_or_none()
        if emp and emp.user_id:
            await publish_leave_status_changed(
                user_id=emp.user_id,
                company_id=req.company_id,
                request_id=req.id,
                status=data.status.value,
            )
    except Exception:  # noqa: BLE001
        pass

    return LeaveRequestRead.model_validate(req)


async def _trigger_salary_recompute(employee_id: UUID, start: Date, end: Date) -> None:
    """Fan out a Celery recompute task per day in the range so payroll picks
    up the new leave coverage immediately. Best-effort — if Celery is down
    the nightly cron will still catch up."""
    try:
        from app.tasks.salary_tasks import recompute_for_day

        cur = start
        while cur <= end:
            recompute_for_day.delay(str(employee_id), cur.isoformat())
            cur += timedelta(days=1)
    except Exception:  # noqa: BLE001
        pass


async def _find_overlap(
    db: DbDep,
    employee_id: UUID,
    start: Date,
    end: Date,
    exclude_id: UUID | None = None,
) -> LeaveRequest | None:
    """A pre-flight overlap check used by both admin-create and approval —
    two APPROVED/PENDING leaves can't cover the same day for one employee.
    Returns the conflicting row (if any) so the caller can surface its dates
    in the error message."""
    stmt = select(LeaveRequest).where(
        LeaveRequest.employee_id == employee_id,
        LeaveRequest.status.in_(
            (LeaveStatus.APPROVED.value, LeaveStatus.PENDING.value)
        ),
        and_(LeaveRequest.start_date <= end, LeaveRequest.end_date >= start),
    )
    if exclude_id is not None:
        stmt = stmt.where(LeaveRequest.id != exclude_id)
    return (await db.execute(stmt.limit(1))).scalar_one_or_none()


def _raise_overlap(existing: LeaveRequest) -> None:
    raise ValidationAppError(
        "leave.overlap",
        existing_start=existing.start_date.isoformat(),
        existing_end=existing.end_date.isoformat(),
    )


@router.post(
    "/leave-requests/admin",
    response_model=LeaveRequestRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("leave.create"))],
)
async def admin_create_leave_request(
    data: AdminLeaveRequestCreate,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> LeaveRequestRead:
    """Admin records a leave on behalf of an employee — common when employees
    request time off verbally or via a paper form. Pre-approved by default,
    so payroll picks it up the next recompute pass."""
    company_id = _company_id(user, tenant)

    emp = (
        await db.execute(select(Employee).where(Employee.id == data.employee_id))
    ).scalar_one_or_none()
    if not emp:
        raise NotFoundError("employee.not_found")

    overlap = await _find_overlap(db, emp.id, data.start_date, data.end_date)
    if overlap is not None:
        _raise_overlap(overlap)

    days = (data.end_date - data.start_date).days + 1
    request = LeaveRequest(
        company_id=company_id,
        employee_id=emp.id,
        leave_type_id=data.leave_type_id,
        start_date=data.start_date,
        end_date=data.end_date,
        days=days,
        reason=data.reason,
        document_url=data.document_url,
        override_amount=data.override_amount,
        status=(
            LeaveStatus.APPROVED if data.auto_approve else LeaveStatus.PENDING
        ),
        approved_by=user.id if data.auto_approve else None,
        approved_at=datetime.now(timezone.utc) if data.auto_approve else None,
        decision_note=data.decision_note,
    )
    db.add(request)
    await db.commit()
    await db.refresh(request)

    await audit_service.record(
        db,
        action="leave.admin_create",
        actor_id=user.id,
        actor_role=user.role,
        company_id=company_id,
        resource_type="leave_request",
        resource_id=request.id,
        payload={
            "employee_id": str(emp.id),
            "auto_approved": data.auto_approve,
            "days": days,
        },
        commit=True,
    )

    if data.auto_approve:
        await _trigger_salary_recompute(emp.id, data.start_date, data.end_date)

    return LeaveRequestRead.model_validate(request)


@router.get(
    "/leave-requests/balances",
    response_model=list[LeaveBalanceRow],
    dependencies=[Depends(require_permission("leave.read"))],
)
async def leave_balances(
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
    year: int = Query(default_factory=lambda: datetime.now(timezone.utc).year, ge=2000, le=2100),
) -> list[LeaveBalanceRow]:
    """One row per (employee, leave_type) showing days used in the given
    calendar year. Used by the Balances tab — quick eyeball of who's
    burning through their entitlement."""
    _company_id(user, tenant)

    employees = (
        await db.execute(
            select(Employee).where(Employee.is_active.is_(True)).order_by(Employee.full_name)
        )
    ).scalars().all()
    types = (
        await db.execute(
            select(LeaveType).where(LeaveType.is_active.is_(True)).order_by(LeaveType.name)
        )
    ).scalars().all()

    # Pull all approved leaves overlapping the year in one query and aggregate
    # in Python — gets us per-(emp, type) sums without N×M roundtrips.
    year_start = Date(year, 1, 1)
    year_end = Date(year, 12, 31)
    rows = (
        await db.execute(
            select(LeaveRequest).where(
                LeaveRequest.status == LeaveStatus.APPROVED.value,
                LeaveRequest.start_date <= year_end,
                LeaveRequest.end_date >= year_start,
            )
        )
    ).scalars().all()

    # Reuse the per-day base helper from the salary engine so the auto-amount
    # math here matches what payroll actually accrues.
    from decimal import Decimal as _D

    from app.services.salary_service import _per_day_base

    employees_by_id = {emp.id: emp for emp in employees}
    used: dict[tuple[UUID, UUID], int] = {}
    paid_total: dict[tuple[UUID, UUID], _D] = {}
    for r in rows:
        # Clamp the leave window to the requested year so a Dec → Jan leave
        # is split correctly across two annual buckets.
        s = max(r.start_date, year_start)
        e = min(r.end_date, year_end)
        d = (e - s).days + 1
        if d <= 0:
            continue
        key = (r.employee_id, r.leave_type_id)
        used[key] = used.get(key, 0) + d
        # Money side: only counted for paid types and if the employee record
        # is still around. We compute the amount-per-day and multiply by the
        # clamped overlap so cross-year leaves are split correctly.
        emp_obj = employees_by_id.get(r.employee_id)
        if emp_obj is None:
            continue
        type_obj = next((t for t in types if t.id == r.leave_type_id), None)
        if type_obj is None or not type_obj.paid:
            continue
        if r.override_amount is not None and r.days and r.days > 0:
            per_day = _D(r.override_amount) / _D(int(r.days))
        else:
            per_day = _per_day_base(emp_obj)
        paid_total[key] = paid_total.get(key, _D("0")) + (per_day * _D(d)).quantize(_D("0.01"))

    # Manual carry-over / opening-balance adjustments folded in.
    adj_rows = (
        await db.execute(
            select(LeaveAdjustment).where(LeaveAdjustment.year == year)
        )
    ).scalars().all()
    for a in adj_rows:
        key = (a.employee_id, a.leave_type_id)
        used[key] = used.get(key, 0) + int(a.days_delta or 0)
        paid_total[key] = paid_total.get(key, _D("0")) + _D(a.amount_delta or 0)

    out: list[LeaveBalanceRow] = []
    for emp in employees:
        for lt in types:
            u = used.get((emp.id, lt.id), 0)
            remaining = (
                lt.max_days_per_year - u if lt.max_days_per_year is not None else None
            )
            out.append(
                LeaveBalanceRow(
                    employee_id=emp.id,
                    employee_code=emp.employee_code,
                    full_name=emp.full_name,
                    photo_url=emp.photo_url,
                    leave_type_id=lt.id,
                    leave_type_name=lt.name,
                    paid=lt.paid,
                    max_days_per_year=lt.max_days_per_year,
                    used_days=u,
                    remaining=remaining,
                    total_paid_amount=paid_total.get((emp.id, lt.id), _D("0")),
                )
            )
    return out


# ---------- Leave adjustments (manual carry-over / opening balance) ---------


@router.post(
    "/leave-adjustments",
    response_model=LeaveAdjustmentRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("leave.create"))],
)
async def create_leave_adjustment(
    data: LeaveAdjustmentCreate,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> LeaveAdjustmentRead:
    company_id = _company_id(user, tenant)
    adj = LeaveAdjustment(
        company_id=company_id,
        employee_id=data.employee_id,
        leave_type_id=data.leave_type_id,
        year=data.year,
        days_delta=data.days_delta,
        amount_delta=data.amount_delta,
        reason=data.reason,
        created_by=user.id,
    )
    db.add(adj)
    await db.commit()
    await db.refresh(adj)
    await audit_service.record(
        db,
        action="leave.adjustment_create",
        actor_id=user.id,
        actor_role=user.role,
        company_id=company_id,
        resource_type="leave_adjustment",
        resource_id=adj.id,
        payload={
            "employee_id": str(data.employee_id),
            "year": data.year,
            "days_delta": data.days_delta,
            "amount_delta": str(data.amount_delta),
        },
        commit=True,
    )
    return LeaveAdjustmentRead.model_validate(adj)


@router.get(
    "/leave-adjustments",
    response_model=list[LeaveAdjustmentRead],
    dependencies=[Depends(require_permission("leave.read"))],
)
async def list_leave_adjustments(
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
    year: int | None = Query(None, ge=2000, le=2100),
    employee_id: UUID | None = None,
) -> list[LeaveAdjustmentRead]:
    _company_id(user, tenant)
    stmt = select(LeaveAdjustment).order_by(desc(LeaveAdjustment.created_at))
    if year is not None:
        stmt = stmt.where(LeaveAdjustment.year == year)
    if employee_id is not None:
        stmt = stmt.where(LeaveAdjustment.employee_id == employee_id)
    rows = (await db.execute(stmt)).scalars().all()
    return [LeaveAdjustmentRead.model_validate(r) for r in rows]


@router.delete(
    "/leave-adjustments/{adj_id}",
    response_model=MessageResponse,
    dependencies=[Depends(require_permission("leave.update"))],
)
async def delete_leave_adjustment(
    adj_id: UUID,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> MessageResponse:
    _company_id(user, tenant)
    adj = (
        await db.execute(select(LeaveAdjustment).where(LeaveAdjustment.id == adj_id))
    ).scalar_one_or_none()
    if not adj:
        raise NotFoundError("leave.adjustment_not_found")
    await db.delete(adj)
    await db.commit()
    await audit_service.record(
        db,
        action="leave.adjustment_delete",
        actor_id=user.id,
        actor_role=user.role,
        company_id=adj.company_id,
        resource_type="leave_adjustment",
        resource_id=adj.id,
        commit=True,
    )
    return MessageResponse(message="deleted")


@router.get(
    "/leave-requests/{request_id}",
    response_model=LeaveRequestRead,
    dependencies=[Depends(require_permission("leave.read"))],
)
async def get_leave_request(
    request_id: UUID,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> LeaveRequestRead:
    _company_id(user, tenant)
    req = (
        await db.execute(select(LeaveRequest).where(LeaveRequest.id == request_id))
    ).scalar_one_or_none()
    if not req:
        raise NotFoundError("leave.request_not_found")
    return LeaveRequestRead.model_validate(req)


@router.patch(
    "/leave-requests/{request_id}",
    response_model=LeaveRequestRead,
    dependencies=[Depends(require_permission("leave.update"))],
)
async def update_leave_request(
    request_id: UUID,
    data: LeaveRequestUpdate,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> LeaveRequestRead:
    """Edit an existing leave's override_amount / reason / decision_note.

    Triggers a salary recompute across the leave window when the leave is
    APPROVED — the override change must be reflected in payroll right away.
    """
    _company_id(user, tenant)
    req = (
        await db.execute(select(LeaveRequest).where(LeaveRequest.id == request_id))
    ).scalar_one_or_none()
    if not req:
        raise NotFoundError("leave.request_not_found")

    payload = data.model_dump(exclude_unset=True)
    override_changed = (
        "override_amount" in payload and payload["override_amount"] != req.override_amount
    )
    for f, v in payload.items():
        setattr(req, f, v)
    await db.commit()
    await db.refresh(req)

    await audit_service.record(
        db,
        action="leave.update",
        actor_id=user.id,
        actor_role=user.role,
        company_id=req.company_id,
        resource_type="leave_request",
        resource_id=req.id,
        payload={k: str(v) for k, v in payload.items()},
        commit=True,
    )

    if override_changed and req.status == LeaveStatus.APPROVED.value:
        await _trigger_salary_recompute(req.employee_id, req.start_date, req.end_date)

    return LeaveRequestRead.model_validate(req)


@router.post(
    "/leave-requests/{request_id}/admin-cancel",
    response_model=LeaveRequestRead,
    dependencies=[Depends(require_permission("leave.update"))],
)
async def admin_cancel_leave(
    request_id: UUID,
    data: LeaveDecision,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> LeaveRequestRead:
    """Admin cancels an APPROVED or PENDING leave.

    Why a separate endpoint and not just PATCH? Cancelling a paid leave
    requires un-doing the salary effect — we re-trigger the daily recompute
    so the days flip from "paid leave" back to "absent" (or normal). Audit
    log captures the reason in ``decision_note``.
    """
    _company_id(user, tenant)
    req = (
        await db.execute(select(LeaveRequest).where(LeaveRequest.id == request_id))
    ).scalar_one_or_none()
    if not req:
        raise NotFoundError("leave.request_not_found")
    if req.status == LeaveStatus.CANCELLED.value or req.status == LeaveStatus.CANCELLED:
        raise ValidationAppError("leave.already_cancelled")
    if req.status == LeaveStatus.REJECTED.value or req.status == LeaveStatus.REJECTED:
        raise ValidationAppError("leave.already_decided")

    was_approved = req.status == LeaveStatus.APPROVED.value or req.status == LeaveStatus.APPROVED
    req.status = LeaveStatus.CANCELLED
    req.decision_note = data.decision_note
    req.approved_by = user.id
    req.approved_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(req)

    await audit_service.record(
        db,
        action="leave.admin_cancel",
        actor_id=user.id,
        actor_role=user.role,
        company_id=req.company_id,
        resource_type="leave_request",
        resource_id=req.id,
        payload={"was_approved": was_approved},
        commit=True,
    )

    # If the leave had been APPROVED before, payroll has already counted those
    # days (paid leave → base accrued, late/absence suppressed). Recompute now
    # to roll the effect back.
    if was_approved:
        await _trigger_salary_recompute(req.employee_id, req.start_date, req.end_date)

    return LeaveRequestRead.model_validate(req)


@router.post(
    "/leave-requests/{request_id}/cancel",
    response_model=MessageResponse,
)
async def cancel_leave(
    request_id: UUID,
    user: CurrentUser,
    db: DbDep,
) -> MessageResponse:
    """Employee cancels their own pending request."""
    if user.role != Role.EMPLOYEE:
        raise PermissionDeniedError()
    emp = (
        await db.execute(select(Employee).where(Employee.user_id == user.id))
    ).scalar_one_or_none()
    if not emp:
        raise NotFoundError("employee.not_found")
    req = (
        await db.execute(
            select(LeaveRequest).where(
                LeaveRequest.id == request_id, LeaveRequest.employee_id == emp.id
            )
        )
    ).scalar_one_or_none()
    if not req:
        raise NotFoundError("leave.request_not_found")
    if req.status != LeaveStatus.PENDING:
        raise ValidationAppError("leave.already_decided")
    req.status = LeaveStatus.CANCELLED
    await db.commit()
    return MessageResponse(message="cancelled")
