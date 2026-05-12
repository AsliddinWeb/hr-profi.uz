"""Owner-only endpoints: cross-tenant company management + global stats."""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Body, Query, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import case, desc, func, or_, select

from app.core.deps import DbDep, OwnerUser
from app.core.exceptions import NotFoundError, ValidationAppError
from app.core.permissions import Role
from app.core.security import hash_password
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
from app.schemas.user import UserRead
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


# ---------- Company admin (super-admin) management -------------------------


class CompanyAdminUpdate(BaseModel):
    """Fields the OWNER can patch on a tenant's COMPANY_ADMIN user.

    ``username`` is intentionally absent — usernames are immutable in the
    rest of the codebase (they're part of the unique key + token sub
    semantics). Pass ``password`` to rotate the credentials.
    """

    email: EmailStr | None = None
    full_name: str | None = Field(default=None, max_length=200)
    phone: str | None = Field(default=None, max_length=32)
    language: str | None = Field(default=None, pattern="^(uz|ru|en)$")
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=8, max_length=128)


async def _company_admin(db, company_id: UUID) -> User:
    """The active super-admin of a tenant. Most companies have exactly one
    COMPANY_ADMIN created during /owner/companies onboarding; if a tenant
    accidentally has multiple we return the oldest (the original founder
    account) so the Owner UI stays deterministic."""
    user = (
        await db.execute(
            select(User)
            .where(
                User.company_id == company_id,
                User.role == Role.COMPANY_ADMIN.value,
            )
            .order_by(User.created_at.asc())
            .limit(1)
            .execution_options(skip_tenant_filter=True)
        )
    ).scalar_one_or_none()
    if user is None:
        raise NotFoundError("company.admin_not_found")
    return user


@router.get("/companies/{company_id}/admin", response_model=UserRead)
async def get_company_admin(
    company_id: UUID, db: DbDep, _: OwnerUser
) -> UserRead:
    """Return the tenant's primary COMPANY_ADMIN user."""
    await _get_company(db, company_id)
    return UserRead.model_validate(await _company_admin(db, company_id))


@router.patch("/companies/{company_id}/admin", response_model=UserRead)
async def update_company_admin(
    company_id: UUID,
    data: CompanyAdminUpdate,
    db: DbDep,
    _: OwnerUser,
) -> UserRead:
    """Patch the tenant's primary COMPANY_ADMIN. ``password`` is hashed in
    place; other fields are written directly. Empty payload is a no-op."""
    await _get_company(db, company_id)
    admin = await _company_admin(db, company_id)

    diff = data.model_dump(exclude_unset=True)
    new_password = diff.pop("password", None)

    # If email is being changed, sanity-check uniqueness within the tenant
    # so we don't trip the (company_id, email) unique constraint with a
    # generic 500.
    new_email = diff.get("email")
    if new_email and new_email != admin.email:
        clash = (
            await db.execute(
                select(User.id)
                .where(
                    User.company_id == company_id,
                    User.email == new_email,
                    User.id != admin.id,
                )
                .execution_options(skip_tenant_filter=True)
            )
        ).scalar_one_or_none()
        if clash is not None:
            raise ValidationAppError("user.email_taken")

    for field, value in diff.items():
        setattr(admin, field, value)
    if new_password:
        admin.password_hash = hash_password(new_password)

    await db.commit()
    await db.refresh(admin)
    return UserRead.model_validate(admin)


# Silence unused-import warnings for symbols kept available for future
# owner-only views (e.g. cross-tenant user search).
_ = desc, or_


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
