"""Bonus + Deduction admin endpoints."""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import desc, select

from app.core.deps import CurrentUser, DbDep, TenantId, require_permission
from app.core.exceptions import PermissionDeniedError
from app.models.bonus_deduction import Bonus, Deduction
from app.schemas.bonus_deduction import (
    BonusCreate,
    BonusRead,
    DeductionCreate,
    DeductionRead,
)
from app.services import audit_service

router = APIRouter(tags=["bonuses-deductions"])


def _company_id(user, tenant) -> UUID:
    cid = tenant or user.company_id
    if cid is None:
        raise PermissionDeniedError()
    return cid


@router.post(
    "/bonuses",
    response_model=BonusRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("bonus.create"))],
)
async def create_bonus(
    data: BonusCreate,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> BonusRead:
    company_id = _company_id(user, tenant)
    bonus = Bonus(
        company_id=company_id,
        given_by=user.id,
        applied_at=datetime.now(timezone.utc),
        auto_generated=False,
        **data.model_dump(),
    )
    db.add(bonus)
    await db.commit()
    await db.refresh(bonus)
    await audit_service.record(
        db,
        action="bonus.create",
        actor_id=user.id,
        actor_role=user.role,
        company_id=company_id,
        resource_type="bonus",
        resource_id=bonus.id,
        payload={"amount": str(bonus.amount), "type": str(bonus.type)},
        commit=True,
    )
    # Trigger an async salary recompute so the new bonus shows up live.
    try:
        from app.tasks.salary_tasks import recompute_for_day

        recompute_for_day.delay(str(bonus.employee_id), bonus.applied_date.isoformat())
    except Exception:  # noqa: BLE001
        pass
    return BonusRead.model_validate(bonus)


@router.get(
    "/bonuses",
    response_model=list[BonusRead],
    dependencies=[Depends(require_permission("bonus.read"))],
)
async def list_bonuses(
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
    employee_id: UUID | None = Query(None),
) -> list[BonusRead]:
    _company_id(user, tenant)
    stmt = select(Bonus).order_by(desc(Bonus.applied_at))
    if employee_id:
        stmt = stmt.where(Bonus.employee_id == employee_id)
    rows = (await db.execute(stmt)).scalars().all()
    return [BonusRead.model_validate(r) for r in rows]


@router.post(
    "/deductions",
    response_model=DeductionRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("deduction.create"))],
)
async def create_deduction(
    data: DeductionCreate,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> DeductionRead:
    company_id = _company_id(user, tenant)
    deduction = Deduction(
        company_id=company_id,
        applied_by=user.id,
        applied_at=datetime.now(timezone.utc),
        auto_generated=False,
        **data.model_dump(),
    )
    db.add(deduction)
    await db.commit()
    await db.refresh(deduction)
    await audit_service.record(
        db,
        action="deduction.create",
        actor_id=user.id,
        actor_role=user.role,
        company_id=company_id,
        resource_type="deduction",
        resource_id=deduction.id,
        payload={"amount": str(deduction.amount), "type": str(deduction.type)},
        commit=True,
    )
    try:
        from app.tasks.salary_tasks import recompute_for_day

        recompute_for_day.delay(
            str(deduction.employee_id), deduction.applied_date.isoformat()
        )
    except Exception:  # noqa: BLE001
        pass
    return DeductionRead.model_validate(deduction)


@router.get(
    "/deductions",
    response_model=list[DeductionRead],
    dependencies=[Depends(require_permission("deduction.read"))],
)
async def list_deductions(
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
    employee_id: UUID | None = Query(None),
) -> list[DeductionRead]:
    _company_id(user, tenant)
    stmt = select(Deduction).order_by(desc(Deduction.applied_at))
    if employee_id:
        stmt = stmt.where(Deduction.employee_id == employee_id)
    rows = (await db.execute(stmt)).scalars().all()
    return [DeductionRead.model_validate(r) for r in rows]
