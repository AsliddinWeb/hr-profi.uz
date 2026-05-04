"""Owner-only endpoints: cross-tenant company management + global stats."""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Query, status
from sqlalchemy import case, func, select

from app.core.deps import DbDep, OwnerUser
from app.core.exceptions import NotFoundError
from app.models.branch import Branch
from app.models.company import Company
from app.models.user import User
from app.schemas.common import MessageResponse, Page
from app.schemas.company import (
    CompanyCreateWithAdmin,
    CompanyRead,
    CompanySuspend,
    CompanyUpdate,
)
from app.services import company_service

router = APIRouter(prefix="/owner", tags=["owner"])


@router.get("/companies", response_model=Page[CompanyRead])
async def list_companies(
    db: DbDep,
    _: OwnerUser,
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    q: str | None = Query(None, description="search in name/slug"),
    is_active: bool | None = None,
) -> Page[CompanyRead]:
    stmt = select(Company).execution_options(skip_tenant_filter=True)
    count_stmt = select(func.count(Company.id)).execution_options(skip_tenant_filter=True)

    if q:
        like = f"%{q.lower()}%"
        cond = (func.lower(Company.name).like(like)) | (func.lower(Company.slug).like(like))
        stmt = stmt.where(cond)
        count_stmt = count_stmt.where(cond)
    if is_active is not None:
        stmt = stmt.where(Company.is_active.is_(is_active))
        count_stmt = count_stmt.where(Company.is_active.is_(is_active))

    total = (await db.execute(count_stmt)).scalar_one()
    rows = (
        await db.execute(stmt.order_by(Company.created_at.desc()).offset((page - 1) * size).limit(size))
    ).scalars().all()

    return Page[CompanyRead](
        items=[CompanyRead.model_validate(r) for r in rows],
        total=total,
        page=page,
        size=size,
    )


@router.post("/companies", response_model=CompanyRead, status_code=status.HTTP_201_CREATED)
async def create_company(
    data: CompanyCreateWithAdmin,
    db: DbDep,
    _: OwnerUser,
) -> CompanyRead:
    company, _admin = await company_service.create_company_with_admin(db, data)
    await db.commit()
    await db.refresh(company)
    return CompanyRead.model_validate(company)


async def _get_company(db, company_id: UUID) -> Company:
    stmt = (
        select(Company)
        .where(Company.id == company_id)
        .execution_options(skip_tenant_filter=True)
    )
    company = (await db.execute(stmt)).scalar_one_or_none()
    if not company:
        raise NotFoundError("company.not_found")
    return company


@router.get("/companies/{company_id}", response_model=CompanyRead)
async def get_company(company_id: UUID, db: DbDep, _: OwnerUser) -> CompanyRead:
    return CompanyRead.model_validate(await _get_company(db, company_id))


@router.patch("/companies/{company_id}", response_model=CompanyRead)
async def update_company(
    company_id: UUID,
    data: CompanyUpdate,
    db: DbDep,
    _: OwnerUser,
) -> CompanyRead:
    company = await _get_company(db, company_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(company, field, value)
    await db.commit()
    await db.refresh(company)
    return CompanyRead.model_validate(company)


@router.post("/companies/{company_id}/suspend", response_model=CompanyRead)
async def suspend_company(
    company_id: UUID,
    data: CompanySuspend,
    db: DbDep,
    _: OwnerUser,
) -> CompanyRead:
    company = await _get_company(db, company_id)
    company.is_active = False
    company.suspended_at = datetime.now(timezone.utc)
    company.suspended_reason = data.reason
    await db.commit()
    await db.refresh(company)
    return CompanyRead.model_validate(company)


@router.post("/companies/{company_id}/unsuspend", response_model=CompanyRead)
async def unsuspend_company(company_id: UUID, db: DbDep, _: OwnerUser) -> CompanyRead:
    company = await _get_company(db, company_id)
    company.is_active = True
    company.suspended_at = None
    company.suspended_reason = None
    await db.commit()
    await db.refresh(company)
    return CompanyRead.model_validate(company)


@router.delete(
    "/companies/{company_id}", response_model=MessageResponse, status_code=status.HTTP_200_OK
)
async def delete_company(company_id: UUID, db: DbDep, _: OwnerUser) -> MessageResponse:
    company = await _get_company(db, company_id)
    await db.delete(company)
    await db.commit()
    return MessageResponse(message="deleted")


@router.get("/stats")
async def stats(db: DbDep, _: OwnerUser) -> dict:
    """Aggregate counters for the Owner dashboard.

    Also returns a per-plan breakdown and the 5 most recent companies so the
    dashboard can render rich tiles + a "latest signups" widget without N
    extra round-trips.
    """
    from datetime import datetime, timedelta, timezone

    from app.models.employee import Employee

    companies_row = (
        await db.execute(
            select(
                func.coalesce(
                    func.sum(case((Company.is_active.is_(True), 1), else_=0)), 0
                ),
                func.count(Company.id),
                func.coalesce(
                    func.sum(case((Company.is_active.is_(False), 1), else_=0)),
                    0,
                ),
            ).execution_options(skip_tenant_filter=True)
        )
    ).one()
    companies_active = int(companies_row[0] or 0)
    companies_total = int(companies_row[1] or 0)
    companies_suspended = int(companies_row[2] or 0)

    users_total = (
        await db.execute(
            select(func.count(User.id)).execution_options(skip_tenant_filter=True)
        )
    ).scalar_one()
    branches_total = (
        await db.execute(
            select(func.count(Branch.id)).execution_options(skip_tenant_filter=True)
        )
    ).scalar_one()
    employees_total = (
        await db.execute(
            select(func.count(Employee.id)).execution_options(
                skip_tenant_filter=True
            )
        )
    ).scalar_one()

    # Plan distribution
    by_plan_rows = (
        await db.execute(
            select(Company.plan, func.count(Company.id))
            .group_by(Company.plan)
            .execution_options(skip_tenant_filter=True)
        )
    ).all()
    by_plan: dict[str, int] = {
        (p.value if hasattr(p, "value") else str(p)): int(c)
        for p, c in by_plan_rows
    }

    # 5 most recent companies
    recent_rows = (
        await db.execute(
            select(Company)
            .order_by(Company.created_at.desc())
            .limit(5)
            .execution_options(skip_tenant_filter=True)
        )
    ).scalars().all()
    recent = [
        {
            "id": str(c.id),
            "name": c.name,
            "slug": c.slug,
            "plan": c.plan if isinstance(c.plan, str) else c.plan.value,
            "is_active": c.is_active,
            "created_at": c.created_at.isoformat() if c.created_at else None,
        }
        for c in recent_rows
    ]

    # Companies created in last 30 days
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    new_30d = (
        await db.execute(
            select(func.count(Company.id))
            .where(Company.created_at >= cutoff)
            .execution_options(skip_tenant_filter=True)
        )
    ).scalar_one()

    # Subscriptions ending soon (next 14 days)
    soon = datetime.now(timezone.utc).date() + timedelta(days=14)
    expiring_soon_rows = (
        await db.execute(
            select(Company)
            .where(
                Company.subscription_until.is_not(None),
                Company.subscription_until <= soon,
                Company.is_active.is_(True),
            )
            .order_by(Company.subscription_until.asc())
            .limit(10)
            .execution_options(skip_tenant_filter=True)
        )
    ).scalars().all()
    expiring_soon = [
        {
            "id": str(c.id),
            "name": c.name,
            "slug": c.slug,
            "plan": c.plan if isinstance(c.plan, str) else c.plan.value,
            "subscription_until": (
                c.subscription_until.isoformat() if c.subscription_until else None
            ),
        }
        for c in expiring_soon_rows
    ]

    return {
        "companies": {
            "active": companies_active,
            "total": companies_total,
            "suspended": companies_suspended,
            "new_30d": int(new_30d or 0),
        },
        "users": users_total,
        "branches": branches_total,
        "employees": employees_total,
        "by_plan": by_plan,
        "recent": recent,
        "expiring_soon": expiring_soon,
    }
