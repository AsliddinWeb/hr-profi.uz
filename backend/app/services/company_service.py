"""Company + bootstrap admin creation (Owner-only)."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConflictError
from app.core.permissions import Role
from app.core.security import hash_password
from app.models.company import Company
from app.models.user import User, UserStatus
from app.schemas.company import CompanyCreate, CompanyCreateWithAdmin


async def slug_exists(db: AsyncSession, slug: str) -> bool:
    stmt = (
        select(Company.id)
        .where(Company.slug == slug)
        .execution_options(skip_tenant_filter=True)
    )
    return (await db.execute(stmt)).scalar_one_or_none() is not None


async def create_company(db: AsyncSession, data: CompanyCreate) -> Company:
    if await slug_exists(db, data.slug):
        raise ConflictError("company.slug_taken")
    company = Company(**data.model_dump())
    db.add(company)
    await db.flush()
    return company


async def create_company_with_admin(
    db: AsyncSession,
    data: CompanyCreateWithAdmin,
) -> tuple[Company, User]:
    if await slug_exists(db, data.slug):
        raise ConflictError("company.slug_taken")

    company_payload = data.model_dump(
        exclude={"admin_username", "admin_email", "admin_password", "admin_full_name"}
    )
    company = Company(**company_payload)
    db.add(company)
    await db.flush()  # company.id needs to exist for the user FK

    admin = User(
        company_id=company.id,
        username=data.admin_username,
        email=data.admin_email,
        password_hash=hash_password(data.admin_password),
        role=Role.COMPANY_ADMIN,
        status=UserStatus.ACTIVE,
        full_name=data.admin_full_name,
        language=data.language_default,
        is_active=True,
    )
    db.add(admin)
    await db.flush()
    return company, admin


__all__ = ["create_company", "create_company_with_admin", "slug_exists"]
