"""Salary endpoints — mobile + admin."""
from __future__ import annotations

from datetime import date as Date
from datetime import datetime, time, timedelta, timezone
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import asc, case, desc, extract, func, select

from app.core.deps import CurrentUser, DbDep, TenantId, require_permission
from app.core.exceptions import NotFoundError, PermissionDeniedError
from app.core.permissions import Role
from app.models.attendance import (
    AttendanceRecord,
    AttendanceStatus,
    CheckType,
)
from app.models.bonus_deduction import Bonus, Deduction, DeductionType
from app.models.employee import Employee
from app.models.leave import LeaveRequest, LeaveType
from app.models.salary import (
    PeriodStatus,
    SalaryDailyAccrual,
    SalaryPeriod,
    SalaryTransaction,
)
from app.schemas.common import MessageResponse
from app.schemas.salary import (
    BonusRow,
    BulkActionResult,
    BulkRecomputeResult,
    DeductionRow,
    EmployeeBreakdown,
    LeaveRow,
    PeriodApproveRequest,
    PeriodMarkPaidRequest,
    PeriodWithEmployee,
    SalaryDailyRead,
    SalaryDashboardSummary,
    SalaryPeriodRead,
    SalaryTodaySnapshot,
    TopUnpaidEntry,
    TransactionCreate,
    TransactionRead,
)
from app.services import audit_service, salary_service

router = APIRouter(prefix="/salary", tags=["salary"])


# ---------- Mobile (employee self) -------------------------------------------

async def _employee_for_user(db, user) -> Employee:
    if user.role != Role.EMPLOYEE:
        raise PermissionDeniedError()
    emp = (
        await db.execute(select(Employee).where(Employee.user_id == user.id))
    ).scalar_one_or_none()
    if not emp:
        raise NotFoundError("employee.not_found")
    return emp


@router.get("/me/today", response_model=SalaryTodaySnapshot)
async def my_today(user: CurrentUser, db: DbDep) -> SalaryTodaySnapshot:
    emp = await _employee_for_user(db, user)
    accrual, period = await salary_service.get_today_snapshot(db, emp.id)
    pending = (
        (period.total_earned - period.paid_amount).quantize(Decimal("0.01"))
        if period
        else Decimal("0.00")
    )
    return SalaryTodaySnapshot(
        today=SalaryDailyRead.model_validate(accrual) if accrual else None,
        period=SalaryPeriodRead.model_validate(period) if period else None,
        pending_amount=pending,
    )


@router.get("/me/current-month", response_model=SalaryPeriodRead | None)
async def my_current_month(user: CurrentUser, db: DbDep) -> SalaryPeriodRead | None:
    emp = await _employee_for_user(db, user)
    today = datetime.now(timezone.utc).date()
    period = (
        await db.execute(
            select(SalaryPeriod).where(
                SalaryPeriod.employee_id == emp.id,
                SalaryPeriod.year == today.year,
                SalaryPeriod.month == today.month,
            )
        )
    ).scalar_one_or_none()
    return SalaryPeriodRead.model_validate(period) if period else None


@router.get("/me/history", response_model=list[SalaryPeriodRead])
async def my_history(user: CurrentUser, db: DbDep) -> list[SalaryPeriodRead]:
    emp = await _employee_for_user(db, user)
    rows = (
        await db.execute(
            select(SalaryPeriod)
            .where(SalaryPeriod.employee_id == emp.id)
            .order_by(desc(SalaryPeriod.year), desc(SalaryPeriod.month))
        )
    ).scalars().all()
    return [SalaryPeriodRead.model_validate(r) for r in rows]


@router.get("/me/daily", response_model=list[SalaryDailyRead])
async def my_daily(
    user: CurrentUser,
    db: DbDep,
    year: int = Query(...),
    month: int = Query(..., ge=1, le=12),
) -> list[SalaryDailyRead]:
    emp = await _employee_for_user(db, user)
    from sqlalchemy import extract

    rows = (
        await db.execute(
            select(SalaryDailyAccrual)
            .where(
                SalaryDailyAccrual.employee_id == emp.id,
                extract("year", SalaryDailyAccrual.date) == year,
                extract("month", SalaryDailyAccrual.date) == month,
            )
            .order_by(SalaryDailyAccrual.date.asc())
        )
    ).scalars().all()
    return [SalaryDailyRead.model_validate(r) for r in rows]


# ---------- Admin -----------------------------------------------------------

def _company_id(user, tenant) -> UUID:
    cid = tenant or user.company_id
    if cid is None:
        raise PermissionDeniedError()
    return cid


@router.get(
    "/employee/{employee_id}/period/{year}/{month}",
    response_model=SalaryPeriodRead,
    dependencies=[Depends(require_permission("salary.read"))],
)
async def employee_period(
    employee_id: UUID,
    year: int,
    month: int,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> SalaryPeriodRead:
    _company_id(user, tenant)
    period = (
        await db.execute(
            select(SalaryPeriod).where(
                SalaryPeriod.employee_id == employee_id,
                SalaryPeriod.year == year,
                SalaryPeriod.month == month,
            )
        )
    ).scalar_one_or_none()
    if not period:
        raise NotFoundError("salary.period_not_found")
    return SalaryPeriodRead.model_validate(period)


@router.post(
    "/{period_id}/finalize",
    response_model=SalaryPeriodRead,
    dependencies=[Depends(require_permission("salary.update"))],
)
async def finalize_period(
    period_id: UUID,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> SalaryPeriodRead:
    _company_id(user, tenant)
    period = (
        await db.execute(select(SalaryPeriod).where(SalaryPeriod.id == period_id))
    ).scalar_one_or_none()
    if not period:
        raise NotFoundError("salary.period_not_found")
    period.status = PeriodStatus.FINALIZED
    period.finalized_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(period)
    await audit_service.record(
        db,
        action="salary.finalize",
        actor_id=user.id,
        actor_role=user.role,
        company_id=user.company_id,
        resource_type="salary_period",
        resource_id=period.id,
        commit=True,
    )
    return SalaryPeriodRead.model_validate(period)


@router.post(
    "/{period_id}/approve",
    response_model=SalaryPeriodRead,
    dependencies=[Depends(require_permission("salary.approve"))],
)
async def approve_period_endpoint(
    period_id: UUID,
    data: PeriodApproveRequest,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> SalaryPeriodRead:
    """Lock a DRAFT period for payment. Idempotent on already-APPROVED.

    Refreshes totals first so an admin click after the last attendance edit
    captures the latest snapshot. Audit-logged.
    """
    _company_id(user, tenant)
    period = (
        await db.execute(select(SalaryPeriod).where(SalaryPeriod.id == period_id))
    ).scalar_one_or_none()
    if not period:
        raise NotFoundError("salary.period_not_found")
    await salary_service.approve_period(db, period, user.id, notes=data.notes)
    await db.commit()
    await db.refresh(period)
    await audit_service.record(
        db,
        action="salary.approve",
        actor_id=user.id,
        actor_role=user.role,
        company_id=user.company_id,
        resource_type="salary_period",
        resource_id=period.id,
        commit=True,
    )
    return SalaryPeriodRead.model_validate(period)


@router.post(
    "/{period_id}/mark-paid",
    response_model=SalaryPeriodRead,
    dependencies=[Depends(require_permission("salary.approve"))],
)
async def mark_period_paid_endpoint(
    period_id: UUID,
    data: PeriodMarkPaidRequest,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> SalaryPeriodRead:
    """Auto-create a FULL_PAYMENT transaction for the remaining ``pending``
    amount and stamp the period as PAID. Advances already recorded reduce
    the auto-payment so the same money isn't paid twice."""
    _company_id(user, tenant)
    period = (
        await db.execute(select(SalaryPeriod).where(SalaryPeriod.id == period_id))
    ).scalar_one_or_none()
    if not period:
        raise NotFoundError("salary.period_not_found")
    await salary_service.mark_period_paid(
        db,
        period,
        user.id,
        payment_method=data.payment_method,
        reference=data.reference,
        paid_at=data.paid_at,
    )
    await db.commit()
    await db.refresh(period)
    await audit_service.record(
        db,
        action="salary.mark_paid",
        actor_id=user.id,
        actor_role=user.role,
        company_id=user.company_id,
        resource_type="salary_period",
        resource_id=period.id,
        commit=True,
    )
    return SalaryPeriodRead.model_validate(period)


@router.post(
    "/{period_id}/reopen",
    response_model=SalaryPeriodRead,
    dependencies=[Depends(require_permission("salary.approve"))],
)
async def reopen_period_endpoint(
    period_id: UUID,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> SalaryPeriodRead:
    """Revert APPROVED → DRAFT. Refuses if any payment has been recorded."""
    _company_id(user, tenant)
    period = (
        await db.execute(select(SalaryPeriod).where(SalaryPeriod.id == period_id))
    ).scalar_one_or_none()
    if not period:
        raise NotFoundError("salary.period_not_found")
    try:
        await salary_service.reopen_period(db, period, user.id)
    except ValueError as e:
        from app.core.exceptions import ValidationAppError

        raise ValidationAppError(f"salary.{e}") from e
    await db.commit()
    await db.refresh(period)
    return SalaryPeriodRead.model_validate(period)


@router.post(
    "/transactions",
    response_model=TransactionRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("salary.create"))],
)
async def create_transaction(
    data: TransactionCreate,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> TransactionRead:
    company_id = _company_id(user, tenant)
    tx = SalaryTransaction(company_id=company_id, **data.model_dump())
    db.add(tx)

    # If FULL_PAYMENT, mark the period as PAID and bump paid_amount.
    if data.period_id:
        period = (
            await db.execute(select(SalaryPeriod).where(SalaryPeriod.id == data.period_id))
        ).scalar_one_or_none()
        if period:
            period.paid_amount = (period.paid_amount or Decimal(0)) + data.amount
            if data.type.value == "FULL_PAYMENT":
                period.status = PeriodStatus.PAID

    await db.commit()
    await db.refresh(tx)
    return TransactionRead.model_validate(tx)


@router.get(
    "/transactions",
    response_model=list[TransactionRead],
    dependencies=[Depends(require_permission("salary.read"))],
)
async def list_transactions(
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
    employee_id: UUID | None = None,
) -> list[TransactionRead]:
    _company_id(user, tenant)
    stmt = select(SalaryTransaction).order_by(desc(SalaryTransaction.paid_at))
    if employee_id:
        stmt = stmt.where(SalaryTransaction.employee_id == employee_id)
    rows = (await db.execute(stmt)).scalars().all()
    return [TransactionRead.model_validate(r) for r in rows]


@router.get(
    "/employee/{employee_id}/today",
    response_model=SalaryTodaySnapshot,
    dependencies=[Depends(require_permission("salary.read"))],
)
async def admin_employee_today(
    employee_id: UUID,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> SalaryTodaySnapshot:
    """Today's accrual + this month's period for one employee.

    Used by the admin EmployeeEdit page's live-earnings widget. The frontend
    polls this and reconciles in-progress check-ins client-side.
    """
    _company_id(user, tenant)
    accrual, period = await salary_service.get_today_snapshot(db, employee_id)
    pending = (
        (period.total_earned - period.paid_amount).quantize(Decimal("0.01"))
        if period
        else Decimal("0.00")
    )
    return SalaryTodaySnapshot(
        today=SalaryDailyRead.model_validate(accrual) if accrual else None,
        period=SalaryPeriodRead.model_validate(period) if period else None,
        pending_amount=pending,
    )


@router.post(
    "/employee/{employee_id}/recompute",
    response_model=MessageResponse,
    dependencies=[Depends(require_permission("salary.update"))],
)
async def admin_recompute(
    employee_id: UUID,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
    date_iso: str | None = Query(None, alias="date"),
) -> MessageResponse:
    """Trigger a salary recompute for one employee+day. Useful when an admin
    has just edited attendance/bonuses and wants the period updated now
    instead of waiting for the nightly job."""
    _company_id(user, tenant)

    day = Date.fromisoformat(date_iso) if date_iso else datetime.now(timezone.utc).date()
    await salary_service.recompute_for_day(db, employee_id, day)
    await db.commit()
    return MessageResponse(message="recomputed")


# ---------- Bulk admin operations ------------------------------------------


@router.get(
    "/periods",
    response_model=list[PeriodWithEmployee],
    dependencies=[Depends(require_permission("salary.read"))],
)
async def list_period_rows(
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
    branch_id: UUID | None = None,
    department_id: UUID | None = None,
) -> list[PeriodWithEmployee]:
    """One row per active employee for the given month, with their period (if
    any) joined in. Replaces the N×roundtrips the legacy admin page used to
    do — a single query feeds the whole table."""
    _company_id(user, tenant)

    emp_stmt = select(Employee).where(Employee.is_active.is_(True))
    if branch_id is not None:
        emp_stmt = emp_stmt.where(Employee.branch_id == branch_id)
    if department_id is not None:
        emp_stmt = emp_stmt.where(Employee.department_id == department_id)
    employees = (await db.execute(emp_stmt.order_by(Employee.full_name))).scalars().all()

    period_stmt = select(SalaryPeriod).where(
        SalaryPeriod.year == year, SalaryPeriod.month == month
    )
    period_rows = (await db.execute(period_stmt)).scalars().all()
    period_by_emp: dict[UUID, SalaryPeriod] = {p.employee_id: p for p in period_rows}

    # Whether each employee has any attendance today — feeds the "active
    # working" green dot in the periods table.
    today = datetime.now(timezone.utc).date()
    today_start = datetime.combine(today, time.min, tzinfo=timezone.utc)
    today_end = today_start + timedelta(days=1)
    attended_today = set(
        r[0]
        for r in (
            await db.execute(
                select(AttendanceRecord.employee_id)
                .where(
                    AttendanceRecord.timestamp >= today_start,
                    AttendanceRecord.timestamp < today_end,
                    AttendanceRecord.status != AttendanceStatus.REJECTED,
                )
                .distinct()
            )
        ).all()
    )

    out: list[PeriodWithEmployee] = []
    for emp in employees:
        p = period_by_emp.get(emp.id)
        pending = (
            (p.total_earned - p.paid_amount).quantize(Decimal("0.01"))
            if p
            else Decimal("0.00")
        )
        out.append(
            PeriodWithEmployee(
                employee_id=emp.id,
                employee_code=emp.employee_code,
                full_name=emp.full_name,
                photo_url=emp.photo_url,
                branch_id=emp.branch_id,
                department_id=emp.department_id,
                position=emp.position,
                period=SalaryPeriodRead.model_validate(p) if p else None,
                pending_amount=pending,
                has_attendance_today=emp.id in attended_today,
            )
        )
    return out


@router.post(
    "/recompute-bulk",
    response_model=BulkRecomputeResult,
    dependencies=[Depends(require_permission("salary.update"))],
)
async def admin_recompute_bulk(
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
    branch_id: UUID | None = None,
    employee_id: UUID | None = None,
) -> BulkRecomputeResult:
    """Recompute every (employee, day) in the month synchronously. For a small
    company (<100 employees) this finishes in a few seconds; for bigger ones
    we still complete in a single request so the admin doesn't have to chase
    Celery progress."""
    _company_id(user, tenant)

    emp_stmt = select(Employee).where(Employee.is_active.is_(True))
    if branch_id is not None:
        emp_stmt = emp_stmt.where(Employee.branch_id == branch_id)
    if employee_id is not None:
        emp_stmt = emp_stmt.where(Employee.id == employee_id)
    employees = (await db.execute(emp_stmt)).scalars().all()

    days_total = 0
    for emp in employees:
        days_total += await salary_service.recompute_period(db, emp.id, year, month)
    await db.commit()

    await audit_service.record(
        db,
        action="salary.recompute_bulk",
        actor_id=user.id,
        actor_role=user.role,
        company_id=user.company_id,
        resource_type="salary_period",
        resource_id=None,
        payload={"year": year, "month": month, "employees": len(employees)},
        commit=True,
    )
    return BulkRecomputeResult(queued_employees=len(employees), days=days_total)


@router.get(
    "/employee/{employee_id}/breakdown",
    response_model=EmployeeBreakdown,
    dependencies=[Depends(require_permission("salary.read"))],
)
async def employee_breakdown(
    employee_id: UUID,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
) -> EmployeeBreakdown:
    """One-shot detail for the per-employee salary page: period totals, daily
    breakdown, every bonus / deduction / leave / transaction touching the
    month. Replaces 5 separate calls the legacy modal used to make."""
    _company_id(user, tenant)

    period = (
        await db.execute(
            select(SalaryPeriod).where(
                SalaryPeriod.employee_id == employee_id,
                SalaryPeriod.year == year,
                SalaryPeriod.month == month,
            )
        )
    ).scalar_one_or_none()

    daily = (
        await db.execute(
            select(SalaryDailyAccrual)
            .where(
                SalaryDailyAccrual.employee_id == employee_id,
                extract("year", SalaryDailyAccrual.date) == year,
                extract("month", SalaryDailyAccrual.date) == month,
            )
            .order_by(asc(SalaryDailyAccrual.date))
        )
    ).scalars().all()

    month_start = Date(year, month, 1)
    month_end = (
        Date(year + 1, 1, 1) if month == 12 else Date(year, month + 1, 1)
    ) - timedelta(days=1)

    bonuses = (
        await db.execute(
            select(Bonus)
            .where(
                Bonus.employee_id == employee_id,
                Bonus.applied_date >= month_start,
                Bonus.applied_date <= month_end,
            )
            .order_by(desc(Bonus.applied_date))
        )
    ).scalars().all()

    deductions = (
        await db.execute(
            select(Deduction)
            .where(
                Deduction.employee_id == employee_id,
                Deduction.applied_date >= month_start,
                Deduction.applied_date <= month_end,
            )
            .order_by(desc(Deduction.applied_date))
        )
    ).scalars().all()

    transactions = (
        await db.execute(
            select(SalaryTransaction)
            .where(
                SalaryTransaction.employee_id == employee_id,
                SalaryTransaction.paid_at >= datetime.combine(month_start, time.min, tzinfo=timezone.utc),
                SalaryTransaction.paid_at <= datetime.combine(month_end, time.max, tzinfo=timezone.utc),
            )
            .order_by(desc(SalaryTransaction.paid_at))
        )
    ).scalars().all()

    leaves = (
        await db.execute(
            select(LeaveRequest, LeaveType)
            .join(LeaveType, LeaveType.id == LeaveRequest.leave_type_id)
            .where(
                LeaveRequest.employee_id == employee_id,
                LeaveRequest.start_date <= month_end,
                LeaveRequest.end_date >= month_start,
            )
            .order_by(desc(LeaveRequest.start_date))
        )
    ).all()

    return EmployeeBreakdown(
        period=SalaryPeriodRead.model_validate(period) if period else None,
        daily=[SalaryDailyRead.model_validate(d) for d in daily],
        bonuses=[
            BonusRow(
                id=b.id,
                type=str(b.type.value if hasattr(b.type, "value") else b.type),
                amount=b.amount,
                reason=b.reason,
                applied_date=b.applied_date,
                auto_generated=b.auto_generated,
            )
            for b in bonuses
        ],
        deductions=[
            DeductionRow(
                id=d.id,
                type=str(d.type.value if hasattr(d.type, "value") else d.type),
                amount=d.amount,
                reason=d.reason,
                applied_date=d.applied_date,
                auto_generated=d.auto_generated,
            )
            for d in deductions
        ],
        transactions=[TransactionRead.model_validate(t) for t in transactions],
        leaves=[
            LeaveRow(
                id=req.id,
                leave_type_name=lt.name,
                paid=lt.paid,
                start_date=req.start_date,
                end_date=req.end_date,
                days=req.days,
                status=str(req.status.value if hasattr(req.status, "value") else req.status),
                override_amount=req.override_amount,
            )
            for req, lt in leaves
        ],
    )


# ============ Bulk approve / mark-paid =====================================


@router.post(
    "/bulk/approve",
    response_model=BulkActionResult,
    dependencies=[Depends(require_permission("salary.approve"))],
)
async def bulk_approve(
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
) -> BulkActionResult:
    """Approve every DRAFT/FINALIZED period for the company in (year, month)."""
    company_id = _company_id(user, tenant)
    n = await salary_service.bulk_approve_company(
        db, company_id, year, month, actor_id=user.id
    )
    await db.commit()
    await audit_service.record(
        db,
        action="salary.bulk_approve",
        actor_id=user.id,
        actor_role=user.role,
        company_id=company_id,
        resource_type="salary_period",
        resource_id=None,
        details={"year": year, "month": month, "affected": n},
        commit=True,
    )
    return BulkActionResult(affected=n)


@router.post(
    "/bulk/mark-paid",
    response_model=BulkActionResult,
    dependencies=[Depends(require_permission("salary.approve"))],
)
async def bulk_mark_paid(
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
    payment_method: str | None = Query("cash", max_length=32),
) -> BulkActionResult:
    """Auto-create FULL_PAYMENT transactions for every APPROVED period and
    mark them PAID. Skips periods with `total_earned == 0`."""
    company_id = _company_id(user, tenant)
    n = await salary_service.bulk_mark_paid_company(
        db, company_id, year, month, actor_id=user.id, payment_method=payment_method
    )
    await db.commit()
    await audit_service.record(
        db,
        action="salary.bulk_mark_paid",
        actor_id=user.id,
        actor_role=user.role,
        company_id=company_id,
        resource_type="salary_period",
        resource_id=None,
        details={"year": year, "month": month, "affected": n},
        commit=True,
    )
    return BulkActionResult(affected=n)


# ============ Financial summary dashboard ==================================


@router.get(
    "/dashboard/summary",
    response_model=SalaryDashboardSummary,
    dependencies=[Depends(require_permission("salary.read"))],
)
async def dashboard_summary(
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
    year: int | None = Query(None, ge=2000, le=2100),
    month: int | None = Query(None, ge=1, le=12),
) -> SalaryDashboardSummary:
    """Top-level financial dashboard for the salary hub.

    Aggregates the current month's payable/paid/pending plus advances
    outstanding, and includes a top-N unpaid list so the admin sees who
    needs to be paid first.
    """
    _company_id(user, tenant)
    today = datetime.now(timezone.utc).date()
    y = year or today.year
    m = month or today.month

    # Period-level totals.
    period_totals = (
        await db.execute(
            select(
                func.coalesce(func.sum(SalaryPeriod.total_earned), 0),
                func.coalesce(func.sum(SalaryPeriod.paid_amount), 0),
                func.coalesce(func.sum(SalaryPeriod.bonuses_total), 0),
                func.coalesce(func.sum(SalaryPeriod.deductions_total), 0),
                func.coalesce(func.sum(SalaryPeriod.kpi_amount), 0),
                func.coalesce(func.sum(SalaryPeriod.overtime_amount), 0),
                func.count(SalaryPeriod.id),
            ).where(SalaryPeriod.year == y, SalaryPeriod.month == m)
        )
    ).one()
    (
        total_earned,
        total_paid,
        bonuses_total,
        deductions_total,
        kpi_total,
        overtime_total,
        emp_count,
    ) = (
        *[Decimal(t) for t in period_totals[:6]],
        int(period_totals[6]),
    )
    pending = (total_earned - total_paid).quantize(Decimal("0.01"))

    # Status breakdown.
    status_rows = (
        await db.execute(
            select(SalaryPeriod.status, func.count(SalaryPeriod.id))
            .where(SalaryPeriod.year == y, SalaryPeriod.month == m)
            .group_by(SalaryPeriod.status)
        )
    ).all()
    by_status: dict[str, int] = {
        (s.value if hasattr(s, "value") else str(s)): int(c) for s, c in status_rows
    }

    # Advances outstanding — sum of ADVANCE-type Deduction rows for the month
    # (these mirror the SalaryTransaction ADVANCE type 1:1).
    advances = (
        await db.execute(
            select(func.coalesce(func.sum(Deduction.amount), 0)).where(
                Deduction.type == DeductionType.ADVANCE.value,
                extract("year", Deduction.applied_date) == y,
                extract("month", Deduction.applied_date) == m,
            )
        )
    ).scalar_one()

    # YTD paid — Jan 1 → end of selected month.
    ytd_paid = (
        await db.execute(
            select(func.coalesce(func.sum(SalaryPeriod.paid_amount), 0)).where(
                SalaryPeriod.year == y,
                SalaryPeriod.month <= m,
            )
        )
    ).scalar_one()

    # Top 5 unpaid employees.
    unpaid_rows = (
        await db.execute(
            select(
                SalaryPeriod.employee_id,
                Employee.full_name,
                Employee.employee_code,
                (SalaryPeriod.total_earned - SalaryPeriod.paid_amount).label("pending"),
                SalaryPeriod.status,
            )
            .join(Employee, Employee.id == SalaryPeriod.employee_id)
            .where(
                SalaryPeriod.year == y,
                SalaryPeriod.month == m,
                (SalaryPeriod.total_earned - SalaryPeriod.paid_amount) > 0,
            )
            .order_by(desc("pending"))
            .limit(5)
        )
    ).all()
    top_unpaid = [
        TopUnpaidEntry(
            employee_id=r[0],
            full_name=r[1],
            employee_code=r[2],
            pending_amount=Decimal(r[3]),
            status=r[4],
        )
        for r in unpaid_rows
    ]

    return SalaryDashboardSummary(
        year=y,
        month=m,
        employees=emp_count,
        total_earned=total_earned,
        total_paid=total_paid,
        total_pending=pending,
        advances_outstanding=Decimal(advances),
        bonuses_total=bonuses_total,
        deductions_total=deductions_total,
        kpi_total=kpi_total,
        overtime_total=overtime_total,
        by_status=by_status,
        top_unpaid=top_unpaid,
        ytd_paid=Decimal(ytd_paid),
    )
