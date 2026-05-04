"""KPI API — production rebuild.

Endpoints (all under ``/api/v1/kpi``):

Templates:
  GET    /templates                — list (filter: category, active)
  POST   /templates                — create + dry-run formula
  GET    /templates/{id}           — read one
  PATCH  /templates/{id}           — partial update (re-validates formula)
  DELETE /templates/{id}           — soft-deactivate
  POST   /templates/{id}/duplicate — clone with " (copy)" suffix

Variables catalog:
  GET    /variables                — auto-doc'd vars for the formula builder

Assignments:
  GET    /assignments              — paginated list (filters)
  POST   /assignments              — create + immediate compute
  GET    /assignments/{id}         — detail (with denormalized refs)
  PATCH  /assignments/{id}         — partial update
  DELETE /assignments/{id}         — cancel
  POST   /assignments/{id}/recompute
  POST   /assignments/{id}/approve — finalizes; salary bridge writes Bonus
  POST   /assignments/{id}/reject  — drops linked Bonus/Deduction

Bulk:
  POST   /bulk/assign              — assign one template to many employees
  POST   /bulk/recompute           — recompute by period + filters

Data points:
  GET    /datapoints               — list
  POST   /datapoints               — create one
  POST   /datapoints/bulk          — create many
  DELETE /datapoints/{id}          — soft void

Reporting / dashboard:
  GET    /leaderboard              — top scorers for a period
  GET    /dashboard/summary        — top-level numbers + status/category split
  GET    /dashboard/branches       — per-branch breakdown
  GET    /dashboard/trend          — score+reward over the last N months

Mobile / self:
  GET    /me                       — my current month
  GET    /me/history               — my last 12 months
  PATCH  /me/{id}                  — let employee post a response

Audit:
  GET    /assignments/{id}/audit   — full history
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import case, desc, distinct, func, select

from app.core.deps import CurrentUser, DbDep, TenantId, require_permission
from app.core.exceptions import (
    NotFoundError,
    PermissionDeniedError,
    ValidationAppError,
)
from app.core.permissions import Role
from app.models.branch import Branch
from app.models.employee import Employee
from app.models.kpi import (
    KPIAssignment,
    KPIAssignmentStatus,
    KPIAuditEvent,
    KPIAuditLog,
    KPICategory,
    KPIDataPoint,
    KPITemplate,
)
from app.schemas.common import MessageResponse, Page
from app.schemas.kpi import (
    KPIAssignmentApprove,
    KPIAssignmentCreate,
    KPIAssignmentDetail,
    KPIAssignmentRead,
    KPIAssignmentReject,
    KPIAssignmentUpdate,
    KPIAuditLogRead,
    KPIBranchBreakdown,
    KPIBulkAssignRequest,
    KPIBulkAssignResult,
    KPIDashboardSummary,
    KPIDataPointBulkCreate,
    KPIDataPointCreate,
    KPIDataPointRead,
    KPILeaderboardEntry,
    KPIRecomputeRequest,
    KPIRecomputeResult,
    KPIScoreTrendPoint,
    KPITemplateCreate,
    KPITemplateRead,
    KPITemplateUpdate,
    KPIVariable,
)
from app.services import kpi_service

router = APIRouter(prefix="/kpi", tags=["kpi"])


# ============ Helpers ======================================================


def _company_id(user, tenant) -> UUID:
    cid = tenant or user.company_id
    if cid is None:
        raise PermissionDeniedError()
    return cid


# Sample variables used to dry-run formulas during template create/update.
_SAMPLE_VARS: dict[str, float] = {
    "present_days": 22,
    "work_days": 22,
    "absence_days": 0,
    "late_count": 1,
    "late_minutes_total": 15,
    "overtime_hours_total": 4,
    "early_leave_count": 0,
    "leave_days": 0,
    "paid_leave_days": 0,
    "unpaid_leave_days": 0,
    "base_salary": 5_000_000,
    "tenure_years": 1.5,
    "manager_rating": 4,
    "target": 100,
    "weight": 1,
    # Common manual metrics — covered so formulas referencing them validate.
    "sold_amount": 0,
    "deals_closed": 0,
    "tickets_resolved": 0,
    "defects": 0,
    "customer_satisfaction": 0,
}


def _validate_formula_or_raise(formula: str) -> None:
    try:
        kpi_service._safe_eval(formula, _SAMPLE_VARS)  # noqa: SLF001
    except kpi_service.FormulaError as e:
        raise ValidationAppError("kpi.bad_formula", detail=str(e)) from e


def _template_read(tpl: KPITemplate) -> KPITemplateRead:
    """Pydantic from_attributes can't read tiers_json under the alias name
    ``tiers``. Build the dict explicitly."""
    return KPITemplateRead(
        id=tpl.id,
        company_id=tpl.company_id,
        name=tpl.name,
        description=tpl.description,
        category=tpl.category,
        metric_source=tpl.metric_source,
        formula=tpl.formula,
        target_value=tpl.target_value,
        unit=tpl.unit,
        weight=tpl.weight,
        period_kind=tpl.period_kind,
        min_threshold_pct=tpl.min_threshold_pct,
        max_score_cap_pct=tpl.max_score_cap_pct,
        reward_type=tpl.reward_type,
        reward_amount=tpl.reward_amount,
        tiers=tpl.tiers_json,
        requires_manager_review=tpl.requires_manager_review,
        is_active=tpl.is_active,
        created_at=tpl.created_at,
        updated_at=tpl.updated_at,
    )


# ============ Templates ====================================================


@router.get(
    "/templates",
    response_model=list[KPITemplateRead],
    dependencies=[Depends(require_permission("kpi.read"))],
)
async def list_templates(
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
    category: KPICategory | None = None,
    active_only: bool = False,
) -> list[KPITemplateRead]:
    _company_id(user, tenant)
    stmt = select(KPITemplate).order_by(KPITemplate.name)
    if category is not None:
        stmt = stmt.where(KPITemplate.category == category.value)
    if active_only:
        stmt = stmt.where(KPITemplate.is_active.is_(True))
    rows = (await db.execute(stmt)).scalars().all()
    return [_template_read(r) for r in rows]


@router.post(
    "/templates",
    response_model=KPITemplateRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("kpi.create"))],
)
async def create_template(
    data: KPITemplateCreate,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> KPITemplateRead:
    company_id = _company_id(user, tenant)
    _validate_formula_or_raise(data.formula)
    payload = data.model_dump()
    tiers = payload.pop("tiers", None)
    tpl = KPITemplate(
        company_id=company_id,
        tiers_json=[t for t in (tiers or [])] if tiers else None,
        **payload,
    )
    db.add(tpl)
    await db.flush()
    kpi_service._audit(  # noqa: SLF001
        db, company_id,
        event=KPIAuditEvent.CREATED,
        actor_id=user.id,
        template_id=tpl.id,
        payload={"name": tpl.name, "category": tpl.category},
    )
    await db.commit()
    await db.refresh(tpl)
    return _template_read(tpl)


@router.get(
    "/templates/{template_id}",
    response_model=KPITemplateRead,
    dependencies=[Depends(require_permission("kpi.read"))],
)
async def get_template(
    template_id: UUID, user: CurrentUser, db: DbDep, tenant: TenantId
) -> KPITemplateRead:
    _company_id(user, tenant)
    tpl = (
        await db.execute(select(KPITemplate).where(KPITemplate.id == template_id))
    ).scalar_one_or_none()
    if not tpl:
        raise NotFoundError("kpi.template_not_found")
    return _template_read(tpl)


@router.patch(
    "/templates/{template_id}",
    response_model=KPITemplateRead,
    dependencies=[Depends(require_permission("kpi.update"))],
)
async def update_template(
    template_id: UUID,
    data: KPITemplateUpdate,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> KPITemplateRead:
    company_id = _company_id(user, tenant)
    tpl = (
        await db.execute(select(KPITemplate).where(KPITemplate.id == template_id))
    ).scalar_one_or_none()
    if not tpl:
        raise NotFoundError("kpi.template_not_found")
    if data.formula is not None:
        _validate_formula_or_raise(data.formula)

    payload = data.model_dump(exclude_unset=True)
    tiers = payload.pop("tiers", None)
    for k, v in payload.items():
        setattr(tpl, k, v)
    if "tiers" in data.model_fields_set:
        tpl.tiers_json = tiers if tiers else None

    kpi_service._audit(  # noqa: SLF001
        db, company_id,
        event=KPIAuditEvent.UPDATED,
        actor_id=user.id,
        template_id=tpl.id,
        payload=payload,
    )
    await db.commit()
    await db.refresh(tpl)
    return _template_read(tpl)


@router.delete(
    "/templates/{template_id}",
    response_model=MessageResponse,
    dependencies=[Depends(require_permission("kpi.delete"))],
)
async def delete_template(
    template_id: UUID, user: CurrentUser, db: DbDep, tenant: TenantId
) -> MessageResponse:
    _company_id(user, tenant)
    tpl = (
        await db.execute(select(KPITemplate).where(KPITemplate.id == template_id))
    ).scalar_one_or_none()
    if not tpl:
        raise NotFoundError("kpi.template_not_found")
    tpl.is_active = False
    await db.commit()
    return MessageResponse(message="deactivated")


@router.post(
    "/templates/{template_id}/duplicate",
    response_model=KPITemplateRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("kpi.create"))],
)
async def duplicate_template(
    template_id: UUID, user: CurrentUser, db: DbDep, tenant: TenantId
) -> KPITemplateRead:
    company_id = _company_id(user, tenant)
    tpl = (
        await db.execute(select(KPITemplate).where(KPITemplate.id == template_id))
    ).scalar_one_or_none()
    if not tpl:
        raise NotFoundError("kpi.template_not_found")
    copy_name = f"{tpl.name} (copy)"
    # Avoid name collision — append a numeric suffix until unique.
    n = 2
    while (
        await db.execute(
            select(KPITemplate.id).where(
                KPITemplate.company_id == company_id, KPITemplate.name == copy_name
            )
        )
    ).scalar_one_or_none() is not None:
        copy_name = f"{tpl.name} (copy {n})"
        n += 1
    new_tpl = KPITemplate(
        company_id=company_id,
        name=copy_name,
        description=tpl.description,
        category=tpl.category,
        metric_source=tpl.metric_source,
        formula=tpl.formula,
        target_value=tpl.target_value,
        unit=tpl.unit,
        weight=tpl.weight,
        period_kind=tpl.period_kind,
        min_threshold_pct=tpl.min_threshold_pct,
        max_score_cap_pct=tpl.max_score_cap_pct,
        reward_type=tpl.reward_type,
        reward_amount=tpl.reward_amount,
        tiers_json=tpl.tiers_json,
        requires_manager_review=tpl.requires_manager_review,
        is_active=True,
    )
    db.add(new_tpl)
    await db.commit()
    await db.refresh(new_tpl)
    return _template_read(new_tpl)


# ============ Variables catalog ============================================


@router.get(
    "/variables",
    response_model=list[KPIVariable],
    dependencies=[Depends(require_permission("kpi.read"))],
)
async def list_variables(user: CurrentUser, tenant: TenantId) -> list[KPIVariable]:
    _company_id(user, tenant)
    return [KPIVariable(**v) for v in kpi_service.KPI_VARIABLE_CATALOG]


# ============ Assignments ==================================================


@router.get(
    "/assignments",
    response_model=Page[KPIAssignmentDetail],
    dependencies=[Depends(require_permission("kpi.read"))],
)
async def list_assignments(
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
    employee_id: UUID | None = None,
    template_id: UUID | None = None,
    branch_id: UUID | None = None,
    department_id: UUID | None = None,
    year: int | None = None,
    month: int | None = None,
    status_filter: KPIAssignmentStatus | None = Query(None, alias="status"),
    category: KPICategory | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
) -> Page[KPIAssignmentDetail]:
    _company_id(user, tenant)
    today = datetime.now(timezone.utc).date()
    y = year if year is not None else today.year
    m = month if month is not None else today.month

    stmt = (
        select(KPIAssignment, KPITemplate, Employee)
        .join(KPITemplate, KPITemplate.id == KPIAssignment.kpi_template_id)
        .join(Employee, Employee.id == KPIAssignment.employee_id)
        .where(KPIAssignment.year == y, KPIAssignment.month == m)
        .order_by(desc(KPIAssignment.score))
    )
    # BRANCH_MANAGER: pin to own branch via Employee join. The optional
    # ``?branch_id=`` filter still works for Owner/CA/HR.
    if user.role == Role.BRANCH_MANAGER and user.branch_id is not None:
        stmt = stmt.where(Employee.branch_id == user.branch_id)
    if employee_id:
        stmt = stmt.where(KPIAssignment.employee_id == employee_id)
    if template_id:
        stmt = stmt.where(KPIAssignment.kpi_template_id == template_id)
    if branch_id:
        stmt = stmt.where(Employee.branch_id == branch_id)
    if department_id:
        stmt = stmt.where(Employee.department_id == department_id)
    if status_filter:
        stmt = stmt.where(KPIAssignment.status == status_filter.value)
    if category:
        stmt = stmt.where(KPITemplate.category == category.value)

    total = (
        await db.execute(select(func.count()).select_from(stmt.subquery()))
    ).scalar_one()
    rows = (
        await db.execute(stmt.offset((page - 1) * size).limit(size))
    ).all()

    items: list[KPIAssignmentDetail] = []
    for a, tpl, emp in rows:
        items.append(
            KPIAssignmentDetail(
                **{c.key: getattr(a, c.key) for c in a.__table__.columns},
                template_name=tpl.name,
                template_unit=tpl.unit,
                template_category=tpl.category,
                template_period_kind=tpl.period_kind,
                template_reward_type=tpl.reward_type,
                template_target_value=tpl.target_value,
                employee_name=emp.full_name,
                employee_code=emp.employee_code,
                employee_branch_id=emp.branch_id,
                employee_department_id=emp.department_id,
            )
        )
    return Page[KPIAssignmentDetail](items=items, total=total, page=page, size=size)


@router.post(
    "/assignments",
    response_model=KPIAssignmentRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("kpi.create"))],
)
async def create_assignment(
    data: KPIAssignmentCreate,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> KPIAssignmentRead:
    company_id = _company_id(user, tenant)
    # Verify the template is active.
    tpl = (
        await db.execute(
            select(KPITemplate).where(KPITemplate.id == data.kpi_template_id)
        )
    ).scalar_one_or_none()
    if not tpl:
        raise NotFoundError("kpi.template_not_found")
    if not tpl.is_active:
        raise ValidationAppError("kpi.template_inactive")
    assignment = KPIAssignment(
        company_id=company_id,
        weight_at_assignment=tpl.weight,
        status=KPIAssignmentStatus.ACTIVE.value,
        **data.model_dump(),
    )
    db.add(assignment)
    await db.flush()
    kpi_service._audit(  # noqa: SLF001
        db, company_id,
        event=KPIAuditEvent.CREATED,
        actor_id=user.id,
        assignment_id=assignment.id,
        template_id=tpl.id,
        payload={
            "employee_id": str(data.employee_id),
            "year": data.year,
            "month": data.month,
        },
    )
    await kpi_service.recompute_assignment(db, assignment, actor_id=user.id)
    await db.commit()
    await db.refresh(assignment)
    return KPIAssignmentRead.model_validate(assignment)


@router.get(
    "/assignments/{assignment_id}",
    response_model=KPIAssignmentDetail,
    dependencies=[Depends(require_permission("kpi.read"))],
)
async def get_assignment(
    assignment_id: UUID, user: CurrentUser, db: DbDep, tenant: TenantId
) -> KPIAssignmentDetail:
    _company_id(user, tenant)
    row = (
        await db.execute(
            select(KPIAssignment, KPITemplate, Employee)
            .join(KPITemplate, KPITemplate.id == KPIAssignment.kpi_template_id)
            .join(Employee, Employee.id == KPIAssignment.employee_id)
            .where(KPIAssignment.id == assignment_id)
        )
    ).first()
    if not row:
        raise NotFoundError("kpi.assignment_not_found")
    a, tpl, emp = row
    return KPIAssignmentDetail(
        **{c.key: getattr(a, c.key) for c in a.__table__.columns},
        template_name=tpl.name,
        template_unit=tpl.unit,
        template_category=tpl.category,
        template_period_kind=tpl.period_kind,
        template_reward_type=tpl.reward_type,
        template_target_value=tpl.target_value,
        employee_name=emp.full_name,
        employee_code=emp.employee_code,
        employee_branch_id=emp.branch_id,
        employee_department_id=emp.department_id,
    )


@router.patch(
    "/assignments/{assignment_id}",
    response_model=KPIAssignmentRead,
    dependencies=[Depends(require_permission("kpi.update"))],
)
async def update_assignment(
    assignment_id: UUID,
    data: KPIAssignmentUpdate,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> KPIAssignmentRead:
    company_id = _company_id(user, tenant)
    a = (
        await db.execute(select(KPIAssignment).where(KPIAssignment.id == assignment_id))
    ).scalar_one_or_none()
    if not a:
        raise NotFoundError("kpi.assignment_not_found")
    payload = data.model_dump(exclude_unset=True)
    if status_v := payload.get("status"):
        a.status = (
            status_v.value if hasattr(status_v, "value") else status_v
        )
        payload.pop("status")
    for k, v in payload.items():
        setattr(a, k, v)
    kpi_service._audit(  # noqa: SLF001
        db, company_id,
        event=KPIAuditEvent.UPDATED,
        actor_id=user.id,
        assignment_id=a.id,
        template_id=a.kpi_template_id,
        payload=data.model_dump(exclude_unset=True, mode="json"),
    )
    await db.commit()
    await db.refresh(a)
    return KPIAssignmentRead.model_validate(a)


@router.delete(
    "/assignments/{assignment_id}",
    response_model=MessageResponse,
    dependencies=[Depends(require_permission("kpi.delete"))],
)
async def cancel_assignment(
    assignment_id: UUID, user: CurrentUser, db: DbDep, tenant: TenantId
) -> MessageResponse:
    company_id = _company_id(user, tenant)
    a = (
        await db.execute(select(KPIAssignment).where(KPIAssignment.id == assignment_id))
    ).scalar_one_or_none()
    if not a:
        raise NotFoundError("kpi.assignment_not_found")
    a.status = KPIAssignmentStatus.CANCELLED.value
    kpi_service._audit(  # noqa: SLF001
        db, company_id,
        event=KPIAuditEvent.CANCELLED,
        actor_id=user.id,
        assignment_id=a.id,
        template_id=a.kpi_template_id,
    )
    await db.commit()
    return MessageResponse(message="cancelled")


@router.post(
    "/assignments/{assignment_id}/recompute",
    response_model=KPIAssignmentRead,
    dependencies=[Depends(require_permission("kpi.update"))],
)
async def recompute_one(
    assignment_id: UUID, user: CurrentUser, db: DbDep, tenant: TenantId
) -> KPIAssignmentRead:
    _company_id(user, tenant)
    a = (
        await db.execute(select(KPIAssignment).where(KPIAssignment.id == assignment_id))
    ).scalar_one_or_none()
    if not a:
        raise NotFoundError("kpi.assignment_not_found")
    await kpi_service.recompute_assignment(db, a, actor_id=user.id)
    await db.commit()
    await db.refresh(a)
    return KPIAssignmentRead.model_validate(a)


async def _enforce_bm_branch_on_assignment(
    db, user, assignment: KPIAssignment
) -> None:
    """For BRANCH_MANAGER actors: refuse the action if the assignment's
    employee isn't in the manager's branch. Hides existence on mismatch."""
    if user.role != Role.BRANCH_MANAGER or user.branch_id is None:
        return
    emp = (
        await db.execute(
            select(Employee).where(Employee.id == assignment.employee_id)
        )
    ).scalar_one_or_none()
    if not emp or emp.branch_id != user.branch_id:
        raise NotFoundError("kpi.assignment_not_found")


@router.post(
    "/assignments/{assignment_id}/approve",
    response_model=KPIAssignmentRead,
    dependencies=[Depends(require_permission("kpi.approve"))],
)
async def approve_one(
    assignment_id: UUID,
    data: KPIAssignmentApprove,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> KPIAssignmentRead:
    _company_id(user, tenant)
    a = (
        await db.execute(select(KPIAssignment).where(KPIAssignment.id == assignment_id))
    ).scalar_one_or_none()
    if not a:
        raise NotFoundError("kpi.assignment_not_found")
    await _enforce_bm_branch_on_assignment(db, user, a)
    if a.status in (
        KPIAssignmentStatus.PAID.value,
        KPIAssignmentStatus.REJECTED.value,
        KPIAssignmentStatus.CANCELLED.value,
    ):
        raise ValidationAppError("kpi.assignment_finalized")
    await kpi_service.approve_assignment(
        db,
        a,
        actor_id=user.id,
        manager_rating=data.manager_rating,
        manager_comment=data.manager_comment,
        override_reward=data.override_reward,
    )
    await db.commit()
    await db.refresh(a)
    return KPIAssignmentRead.model_validate(a)


@router.post(
    "/assignments/{assignment_id}/reject",
    response_model=KPIAssignmentRead,
    dependencies=[Depends(require_permission("kpi.approve"))],
)
async def reject_one(
    assignment_id: UUID,
    data: KPIAssignmentReject,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> KPIAssignmentRead:
    _company_id(user, tenant)
    a = (
        await db.execute(select(KPIAssignment).where(KPIAssignment.id == assignment_id))
    ).scalar_one_or_none()
    if not a:
        raise NotFoundError("kpi.assignment_not_found")
    await _enforce_bm_branch_on_assignment(db, user, a)
    await kpi_service.reject_assignment(
        db, a, actor_id=user.id, reason=data.reason
    )
    await db.commit()
    await db.refresh(a)
    return KPIAssignmentRead.model_validate(a)


@router.get(
    "/assignments/{assignment_id}/audit",
    response_model=list[KPIAuditLogRead],
    dependencies=[Depends(require_permission("kpi.read"))],
)
async def assignment_audit(
    assignment_id: UUID, user: CurrentUser, db: DbDep, tenant: TenantId
) -> list[KPIAuditLogRead]:
    _company_id(user, tenant)
    rows = (
        await db.execute(
            select(KPIAuditLog)
            .where(KPIAuditLog.assignment_id == assignment_id)
            .order_by(desc(KPIAuditLog.created_at))
        )
    ).scalars().all()
    return [KPIAuditLogRead.model_validate(r) for r in rows]


# ============ Bulk =========================================================


@router.post(
    "/bulk/assign",
    response_model=KPIBulkAssignResult,
    dependencies=[Depends(require_permission("kpi.create"))],
)
async def bulk_assign(
    data: KPIBulkAssignRequest,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> KPIBulkAssignResult:
    company_id = _company_id(user, tenant)
    tpl = (
        await db.execute(
            select(KPITemplate).where(KPITemplate.id == data.kpi_template_id)
        )
    ).scalar_one_or_none()
    if not tpl:
        raise NotFoundError("kpi.template_not_found")

    # Resolve target employees.
    emp_stmt = select(Employee.id)
    if data.employee_ids:
        emp_stmt = emp_stmt.where(Employee.id.in_(data.employee_ids))
    if data.branch_ids:
        emp_stmt = emp_stmt.where(Employee.branch_id.in_(data.branch_ids))
    if data.department_ids:
        emp_stmt = emp_stmt.where(Employee.department_id.in_(data.department_ids))
    emp_ids = (await db.execute(emp_stmt)).scalars().all()
    if not emp_ids:
        return KPIBulkAssignResult(created=0, skipped=0, failed=0)

    # Find existing rows for this period.
    existing = (
        await db.execute(
            select(KPIAssignment.employee_id).where(
                KPIAssignment.kpi_template_id == data.kpi_template_id,
                KPIAssignment.year == data.year,
                KPIAssignment.month == data.month,
                KPIAssignment.employee_id.in_(emp_ids),
            )
        )
    ).scalars().all()
    existing_set = set(existing)

    created = skipped = failed = 0
    failures: list[str] = []
    for eid in emp_ids:
        if eid in existing_set:
            if data.skip_existing:
                skipped += 1
                continue
        try:
            a = KPIAssignment(
                company_id=company_id,
                employee_id=eid,
                kpi_template_id=data.kpi_template_id,
                year=data.year,
                month=data.month,
                target=data.target,
                weight_at_assignment=tpl.weight,
                status=KPIAssignmentStatus.ACTIVE.value,
            )
            db.add(a)
            await db.flush()
            await kpi_service.recompute_assignment(db, a, actor_id=user.id)
            created += 1
        except Exception as e:  # noqa: BLE001
            failed += 1
            failures.append(f"{eid}: {e}")

    kpi_service._audit(  # noqa: SLF001
        db, company_id,
        event=KPIAuditEvent.BULK_ASSIGN,
        actor_id=user.id,
        template_id=data.kpi_template_id,
        payload={
            "year": data.year, "month": data.month,
            "created": created, "skipped": skipped, "failed": failed,
        },
    )
    await db.commit()
    return KPIBulkAssignResult(
        created=created, skipped=skipped, failed=failed, failures=failures[:50]
    )


@router.post(
    "/bulk/recompute",
    response_model=KPIRecomputeResult,
    dependencies=[Depends(require_permission("kpi.update"))],
)
async def bulk_recompute(
    data: KPIRecomputeRequest,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> KPIRecomputeResult:
    company_id = _company_id(user, tenant)
    result = await kpi_service.recompute_company_assignments(
        db, company_id, data.year, data.month,
        actor_id=user.id,
        template_ids=data.template_ids,
        employee_ids=data.employee_ids,
    )
    await db.commit()
    return KPIRecomputeResult(
        recomputed=result["recomputed"],
        failed=result["failed"],
        failures=result["failures"][:50],
    )


# ============ Data points ==================================================


@router.get(
    "/datapoints",
    response_model=Page[KPIDataPointRead],
    dependencies=[Depends(require_permission("kpi.read"))],
)
async def list_datapoints(
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
    employee_id: UUID | None = None,
    metric_key: str | None = None,
    from_date: datetime | None = Query(None, alias="from"),
    to_date: datetime | None = Query(None, alias="to"),
    include_void: bool = False,
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
) -> Page[KPIDataPointRead]:
    _company_id(user, tenant)
    stmt = select(KPIDataPoint).order_by(desc(KPIDataPoint.recorded_at))
    if employee_id:
        stmt = stmt.where(KPIDataPoint.employee_id == employee_id)
    if metric_key:
        stmt = stmt.where(KPIDataPoint.metric_key == metric_key)
    if from_date:
        stmt = stmt.where(KPIDataPoint.recorded_at >= from_date)
    if to_date:
        stmt = stmt.where(KPIDataPoint.recorded_at < to_date)
    if not include_void:
        stmt = stmt.where(KPIDataPoint.is_void.is_(False))
    total = (
        await db.execute(select(func.count()).select_from(stmt.subquery()))
    ).scalar_one()
    rows = (
        await db.execute(stmt.offset((page - 1) * size).limit(size))
    ).scalars().all()
    return Page[KPIDataPointRead](
        items=[KPIDataPointRead.model_validate(r) for r in rows],
        total=total, page=page, size=size,
    )


@router.post(
    "/datapoints",
    response_model=KPIDataPointRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("kpi.create"))],
)
async def push_datapoint(
    data: KPIDataPointCreate,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> KPIDataPointRead:
    company_id = _company_id(user, tenant)
    payload = data.model_dump()
    payload["recorded_date"] = data.recorded_at.date()
    dp = KPIDataPoint(
        company_id=company_id,
        submitted_by=user.id,
        **payload,
    )
    db.add(dp)
    await db.commit()
    await db.refresh(dp)
    return KPIDataPointRead.model_validate(dp)


@router.post(
    "/datapoints/bulk",
    response_model=MessageResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("kpi.create"))],
)
async def push_datapoints_bulk(
    data: KPIDataPointBulkCreate,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> MessageResponse:
    company_id = _company_id(user, tenant)
    for item in data.items:
        payload = item.model_dump()
        payload["recorded_date"] = item.recorded_at.date()
        db.add(
            KPIDataPoint(
                company_id=company_id,
                submitted_by=user.id,
                **payload,
            )
        )
    await db.commit()
    return MessageResponse(message=f"recorded:{len(data.items)}")


@router.delete(
    "/datapoints/{datapoint_id}",
    response_model=MessageResponse,
    dependencies=[Depends(require_permission("kpi.delete"))],
)
async def void_datapoint(
    datapoint_id: UUID, user: CurrentUser, db: DbDep, tenant: TenantId
) -> MessageResponse:
    _company_id(user, tenant)
    dp = (
        await db.execute(select(KPIDataPoint).where(KPIDataPoint.id == datapoint_id))
    ).scalar_one_or_none()
    if not dp:
        raise NotFoundError("kpi.datapoint_not_found")
    dp.is_void = True
    await db.commit()
    return MessageResponse(message="voided")


# ============ Leaderboard / dashboard =====================================


@router.get(
    "/leaderboard",
    response_model=list[KPILeaderboardEntry],
    dependencies=[Depends(require_permission("kpi.read"))],
)
async def leaderboard(
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
    year: int | None = None,
    month: int | None = None,
    branch_id: UUID | None = None,
    department_id: UUID | None = None,
    limit: int = Query(20, ge=1, le=100),
) -> list[KPILeaderboardEntry]:
    _company_id(user, tenant)
    today = datetime.now(timezone.utc).date()
    y, m = year or today.year, month or today.month

    stmt = (
        select(
            KPIAssignment.employee_id,
            Employee.full_name,
            Employee.employee_code,
            Employee.branch_id,
            Employee.department_id,
            func.coalesce(func.sum(KPIAssignment.score), 0),
            func.coalesce(
                func.sum(KPIAssignment.score * KPIAssignment.weight_at_assignment),
                0,
            ),
            func.coalesce(
                func.sum(
                    case(
                        (KPIAssignment.is_penalty.is_(False), KPIAssignment.computed_reward),
                        else_=0,
                    )
                ),
                0,
            ),
            func.coalesce(
                func.sum(
                    case(
                        (KPIAssignment.is_penalty.is_(True), KPIAssignment.computed_reward),
                        else_=0,
                    )
                ),
                0,
            ),
            func.count(KPIAssignment.id),
            func.coalesce(
                func.sum(
                    case(
                        (
                            KPIAssignment.status == KPIAssignmentStatus.PAID.value,
                            1,
                        ),
                        else_=0,
                    )
                ),
                0,
            ),
        )
        .join(Employee, Employee.id == KPIAssignment.employee_id)
        .where(KPIAssignment.year == y, KPIAssignment.month == m)
        .where(
            KPIAssignment.status != KPIAssignmentStatus.CANCELLED.value,
            KPIAssignment.status != KPIAssignmentStatus.REJECTED.value,
        )
        .group_by(
            KPIAssignment.employee_id,
            Employee.full_name,
            Employee.employee_code,
            Employee.branch_id,
            Employee.department_id,
        )
        .order_by(
            desc(
                func.sum(KPIAssignment.score * KPIAssignment.weight_at_assignment)
            )
        )
        .limit(limit)
    )
    if branch_id:
        stmt = stmt.where(Employee.branch_id == branch_id)
    if department_id:
        stmt = stmt.where(Employee.department_id == department_id)
    rows = (await db.execute(stmt)).all()

    out: list[KPILeaderboardEntry] = []
    for i, r in enumerate(rows, start=1):
        (
            eid, name, code, bid, did,
            total_score, weighted, reward, penalty, count, approved,
        ) = r
        out.append(
            KPILeaderboardEntry(
                employee_id=eid,
                employee_name=name or "",
                employee_code=code,
                branch_id=bid,
                department_id=did,
                total_score=Decimal(total_score or 0),
                weighted_score=Decimal(weighted or 0),
                total_reward=Decimal(reward or 0),
                total_penalty=Decimal(penalty or 0),
                assignments_count=int(count or 0),
                approved_count=int(approved or 0),
                rank=i,
            )
        )
    return out


@router.get(
    "/dashboard/summary",
    response_model=KPIDashboardSummary,
    dependencies=[Depends(require_permission("kpi.read"))],
)
async def dashboard_summary(
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
    year: int | None = None,
    month: int | None = None,
) -> KPIDashboardSummary:
    _company_id(user, tenant)
    today = datetime.now(timezone.utc).date()
    y, m = year or today.year, month or today.month

    base = select(KPIAssignment).where(
        KPIAssignment.year == y, KPIAssignment.month == m
    )

    total = (
        await db.execute(select(func.count()).select_from(base.subquery()))
    ).scalar_one()
    avg_score = (
        await db.execute(
            select(func.coalesce(func.avg(KPIAssignment.score), 0)).where(
                KPIAssignment.year == y, KPIAssignment.month == m
            )
        )
    ).scalar_one()
    total_reward = (
        await db.execute(
            select(
                func.coalesce(
                    func.sum(
                        case(
                            (KPIAssignment.is_penalty.is_(False), KPIAssignment.computed_reward),
                            else_=0,
                        )
                    ),
                    0,
                )
            ).where(KPIAssignment.year == y, KPIAssignment.month == m)
        )
    ).scalar_one()
    total_penalty = (
        await db.execute(
            select(
                func.coalesce(
                    func.sum(
                        case(
                            (KPIAssignment.is_penalty.is_(True), KPIAssignment.computed_reward),
                            else_=0,
                        )
                    ),
                    0,
                )
            ).where(KPIAssignment.year == y, KPIAssignment.month == m)
        )
    ).scalar_one()
    employees_with_kpis = (
        await db.execute(
            select(func.count(distinct(KPIAssignment.employee_id))).where(
                KPIAssignment.year == y, KPIAssignment.month == m
            )
        )
    ).scalar_one()

    by_status_rows = (
        await db.execute(
            select(KPIAssignment.status, func.count(KPIAssignment.id))
            .where(KPIAssignment.year == y, KPIAssignment.month == m)
            .group_by(KPIAssignment.status)
        )
    ).all()
    by_category_rows = (
        await db.execute(
            select(KPITemplate.category, func.count(KPIAssignment.id))
            .join(KPITemplate, KPITemplate.id == KPIAssignment.kpi_template_id)
            .where(KPIAssignment.year == y, KPIAssignment.month == m)
            .group_by(KPITemplate.category)
        )
    ).all()

    return KPIDashboardSummary(
        year=y,
        month=m,
        employees_with_kpis=int(employees_with_kpis or 0),
        total_assignments=int(total or 0),
        avg_score=Decimal(avg_score or 0).quantize(Decimal("0.01")),
        total_reward=Decimal(total_reward or 0),
        total_penalty=Decimal(total_penalty or 0),
        by_status={s: int(c) for s, c in by_status_rows},
        by_category={c: int(n) for c, n in by_category_rows},
    )


@router.get(
    "/dashboard/branches",
    response_model=list[KPIBranchBreakdown],
    dependencies=[Depends(require_permission("kpi.read"))],
)
async def dashboard_branches(
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
    year: int | None = None,
    month: int | None = None,
) -> list[KPIBranchBreakdown]:
    _company_id(user, tenant)
    today = datetime.now(timezone.utc).date()
    y, m = year or today.year, month or today.month

    rows = (
        await db.execute(
            select(
                Employee.branch_id,
                Branch.name,
                func.count(distinct(KPIAssignment.employee_id)),
                func.coalesce(func.avg(KPIAssignment.score), 0),
                func.coalesce(
                    func.sum(
                        case(
                            (KPIAssignment.is_penalty.is_(False), KPIAssignment.computed_reward),
                            else_=0,
                        )
                    ),
                    0,
                ),
            )
            .join(Employee, Employee.id == KPIAssignment.employee_id)
            .join(Branch, Branch.id == Employee.branch_id, isouter=True)
            .where(KPIAssignment.year == y, KPIAssignment.month == m)
            .group_by(Employee.branch_id, Branch.name)
            .order_by(desc(func.coalesce(func.avg(KPIAssignment.score), 0)))
        )
    ).all()
    return [
        KPIBranchBreakdown(
            branch_id=bid,
            branch_name=bname,
            employees=int(emp_count or 0),
            avg_score=Decimal(avg or 0).quantize(Decimal("0.01")),
            total_reward=Decimal(total or 0),
        )
        for bid, bname, emp_count, avg, total in rows
    ]


@router.get(
    "/dashboard/trend",
    response_model=list[KPIScoreTrendPoint],
    dependencies=[Depends(require_permission("kpi.read"))],
)
async def dashboard_trend(
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
    months: int = Query(12, ge=1, le=36),
    employee_id: UUID | None = None,
) -> list[KPIScoreTrendPoint]:
    _company_id(user, tenant)
    stmt = (
        select(
            KPIAssignment.year,
            KPIAssignment.month,
            func.coalesce(func.avg(KPIAssignment.score), 0),
            func.coalesce(
                func.sum(
                    case(
                        (KPIAssignment.is_penalty.is_(False), KPIAssignment.computed_reward),
                        else_=0,
                    )
                ),
                0,
            ),
            func.count(KPIAssignment.id),
        )
        .group_by(KPIAssignment.year, KPIAssignment.month)
        .order_by(desc(KPIAssignment.year), desc(KPIAssignment.month))
        .limit(months)
    )
    if employee_id:
        stmt = stmt.where(KPIAssignment.employee_id == employee_id)
    rows = (await db.execute(stmt)).all()
    # Reverse so the chart reads left → right chronologically.
    rows = list(reversed(rows))
    return [
        KPIScoreTrendPoint(
            year=int(y),
            month=int(m),
            avg_score=Decimal(avg or 0).quantize(Decimal("0.01")),
            total_reward=Decimal(reward or 0),
            assignments=int(count or 0),
        )
        for y, m, avg, reward, count in rows
    ]


# ============ Mobile / self ===============================================


@router.get("/me", response_model=list[KPIAssignmentDetail])
async def my_kpis(user: CurrentUser, db: DbDep) -> list[KPIAssignmentDetail]:
    if user.role != Role.EMPLOYEE:
        raise PermissionDeniedError()
    emp = (
        await db.execute(select(Employee).where(Employee.user_id == user.id))
    ).scalar_one_or_none()
    if not emp:
        raise NotFoundError("employee.not_found")
    today = datetime.now(timezone.utc).date()
    rows = (
        await db.execute(
            select(KPIAssignment, KPITemplate)
            .join(KPITemplate, KPITemplate.id == KPIAssignment.kpi_template_id)
            .where(
                KPIAssignment.employee_id == emp.id,
                KPIAssignment.year == today.year,
                KPIAssignment.month == today.month,
            )
        )
    ).all()
    return [
        KPIAssignmentDetail(
            **{c.key: getattr(a, c.key) for c in a.__table__.columns},
            template_name=tpl.name,
            template_unit=tpl.unit,
            template_category=tpl.category,
            template_period_kind=tpl.period_kind,
            template_reward_type=tpl.reward_type,
            template_target_value=tpl.target_value,
            employee_name=emp.full_name,
            employee_code=emp.employee_code,
            employee_branch_id=emp.branch_id,
            employee_department_id=emp.department_id,
        )
        for a, tpl in rows
    ]


@router.get("/me/history", response_model=list[KPIAssignmentDetail])
async def my_kpi_history(
    user: CurrentUser,
    db: DbDep,
    months: int = Query(12, ge=1, le=24),
) -> list[KPIAssignmentDetail]:
    if user.role != Role.EMPLOYEE:
        raise PermissionDeniedError()
    emp = (
        await db.execute(select(Employee).where(Employee.user_id == user.id))
    ).scalar_one_or_none()
    if not emp:
        raise NotFoundError("employee.not_found")
    rows = (
        await db.execute(
            select(KPIAssignment, KPITemplate)
            .join(KPITemplate, KPITemplate.id == KPIAssignment.kpi_template_id)
            .where(KPIAssignment.employee_id == emp.id)
            .order_by(desc(KPIAssignment.year), desc(KPIAssignment.month))
            .limit(months * 5)
        )
    ).all()
    return [
        KPIAssignmentDetail(
            **{c.key: getattr(a, c.key) for c in a.__table__.columns},
            template_name=tpl.name,
            template_unit=tpl.unit,
            template_category=tpl.category,
            template_period_kind=tpl.period_kind,
            template_reward_type=tpl.reward_type,
            template_target_value=tpl.target_value,
            employee_name=emp.full_name,
            employee_code=emp.employee_code,
            employee_branch_id=emp.branch_id,
            employee_department_id=emp.department_id,
        )
        for a, tpl in rows
    ]


@router.patch("/me/{assignment_id}", response_model=KPIAssignmentRead)
async def my_response(
    assignment_id: UUID,
    data: KPIAssignmentUpdate,
    user: CurrentUser,
    db: DbDep,
) -> KPIAssignmentRead:
    """Employee can only post an ``employee_response`` field on their own
    assignment — everything else is ignored."""
    if user.role != Role.EMPLOYEE:
        raise PermissionDeniedError()
    emp = (
        await db.execute(select(Employee).where(Employee.user_id == user.id))
    ).scalar_one_or_none()
    if not emp:
        raise NotFoundError("employee.not_found")
    a = (
        await db.execute(
            select(KPIAssignment).where(
                KPIAssignment.id == assignment_id,
                KPIAssignment.employee_id == emp.id,
            )
        )
    ).scalar_one_or_none()
    if not a:
        raise NotFoundError("kpi.assignment_not_found")
    if data.employee_response is not None:
        a.employee_response = data.employee_response
    await db.commit()
    await db.refresh(a)
    return KPIAssignmentRead.model_validate(a)
