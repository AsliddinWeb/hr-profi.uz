"""Company-scoped endpoints for COMPANY_ADMIN (read/update own company)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy import select

from app.core.deps import CurrentUser, DbDep, TenantId, require_permission
from app.core.exceptions import NotFoundError, PermissionDeniedError
from app.models.company import Company
from app.schemas.company import CompanyRead, CompanyUpdate

router = APIRouter(prefix="/companies", tags=["companies"])


@router.get(
    "/me",
    response_model=CompanyRead,
    dependencies=[Depends(require_permission("company.read"))],
)
async def my_company(
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> CompanyRead:
    target_id = tenant or user.company_id
    if target_id is None:
        # OWNER without ?company_id=X — they should use /owner endpoints instead.
        raise PermissionDeniedError()
    stmt = (
        select(Company)
        .where(Company.id == target_id)
        .execution_options(skip_tenant_filter=True)
    )
    company = (await db.execute(stmt)).scalar_one_or_none()
    if not company:
        raise NotFoundError("company.not_found")
    return CompanyRead.model_validate(company)


@router.patch(
    "/me",
    response_model=CompanyRead,
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(require_permission("company.update"))],
)
async def update_my_company(
    data: CompanyUpdate,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> CompanyRead:
    target_id = tenant or user.company_id
    if target_id is None:
        raise PermissionDeniedError()

    # Company admin must NOT be able to change plan / subscription_until / is_active.
    # Those are Owner-only fields.
    from app.core.permissions import Role

    if user.role != Role.OWNER:
        for forbidden in ("plan", "subscription_until", "is_active"):
            if forbidden in data.model_fields_set:
                raise PermissionDeniedError()

    stmt = (
        select(Company)
        .where(Company.id == target_id)
        .execution_options(skip_tenant_filter=True)
    )
    company = (await db.execute(stmt)).scalar_one_or_none()
    if not company:
        raise NotFoundError("company.not_found")

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(company, field, value)
    await db.commit()
    await db.refresh(company)
    return CompanyRead.model_validate(company)
