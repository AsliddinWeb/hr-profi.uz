"""Branch CRUD — tenant-scoped via the listener."""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import func, select

from app.core.deps import CurrentUser, DbDep, TenantId, require_permission
from app.core.exceptions import NotFoundError, PermissionDeniedError
from app.models.branch import Branch
from app.schemas.branch import BranchCreate, BranchRead, BranchUpdate
from app.schemas.common import MessageResponse, Page

router = APIRouter(prefix="/branches", tags=["branches"])


def _resolved_company_id(user, tenant) -> UUID:
    cid = tenant or user.company_id
    if cid is None:
        raise PermissionDeniedError()
    return cid


@router.get(
    "",
    response_model=Page[BranchRead],
    dependencies=[Depends(require_permission("branch.read"))],
)
async def list_branches(
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    q: str | None = None,
    is_active: bool | None = None,
) -> Page[BranchRead]:
    _resolved_company_id(user, tenant)

    stmt = select(Branch)
    count_stmt = select(func.count(Branch.id))
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(func.lower(Branch.name).like(like))
        count_stmt = count_stmt.where(func.lower(Branch.name).like(like))
    if is_active is not None:
        stmt = stmt.where(Branch.is_active.is_(is_active))
        count_stmt = count_stmt.where(Branch.is_active.is_(is_active))

    total = (await db.execute(count_stmt)).scalar_one()
    rows = (
        await db.execute(stmt.order_by(Branch.created_at.desc()).offset((page - 1) * size).limit(size))
    ).scalars().all()
    return Page[BranchRead](
        items=[BranchRead.model_validate(r) for r in rows],
        total=total,
        page=page,
        size=size,
    )


@router.post(
    "",
    response_model=BranchRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("branch.create"))],
)
async def create_branch(
    data: BranchCreate,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> BranchRead:
    company_id = _resolved_company_id(user, tenant)
    branch = Branch(company_id=company_id, **data.model_dump())
    db.add(branch)
    await db.commit()
    await db.refresh(branch)
    return BranchRead.model_validate(branch)


async def _get_branch(db, branch_id: UUID) -> Branch:
    stmt = select(Branch).where(Branch.id == branch_id)
    branch = (await db.execute(stmt)).scalar_one_or_none()
    if not branch:
        raise NotFoundError("branch.not_found")
    return branch


@router.get(
    "/{branch_id}",
    response_model=BranchRead,
    dependencies=[Depends(require_permission("branch.read"))],
)
async def get_branch(
    branch_id: UUID,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> BranchRead:
    _resolved_company_id(user, tenant)
    return BranchRead.model_validate(await _get_branch(db, branch_id))


@router.patch(
    "/{branch_id}",
    response_model=BranchRead,
    dependencies=[Depends(require_permission("branch.update"))],
)
async def update_branch(
    branch_id: UUID,
    data: BranchUpdate,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> BranchRead:
    _resolved_company_id(user, tenant)
    branch = await _get_branch(db, branch_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(branch, field, value)
    await db.commit()
    await db.refresh(branch)
    return BranchRead.model_validate(branch)


@router.delete(
    "/{branch_id}",
    response_model=MessageResponse,
    dependencies=[Depends(require_permission("branch.delete"))],
)
async def delete_branch(
    branch_id: UUID,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> MessageResponse:
    _resolved_company_id(user, tenant)
    branch = await _get_branch(db, branch_id)
    # Soft delete — keep historical attendance/audit linked.
    branch.is_active = False
    await db.commit()
    return MessageResponse(message="deactivated")
