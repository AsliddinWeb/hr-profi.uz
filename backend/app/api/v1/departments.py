"""Department CRUD — tenant-scoped, optional tree under Branch."""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import func, select

from app.core.deps import CurrentUser, DbDep, TenantId, require_permission
from app.core.exceptions import NotFoundError, PermissionDeniedError
from app.models.department import Department
from app.schemas.common import MessageResponse, Page
from app.schemas.department import DepartmentCreate, DepartmentRead, DepartmentUpdate

router = APIRouter(prefix="/departments", tags=["departments"])


def _resolved_company_id(user, tenant) -> UUID:
    cid = tenant or user.company_id
    if cid is None:
        raise PermissionDeniedError()
    return cid


@router.get(
    "",
    response_model=Page[DepartmentRead],
    dependencies=[Depends(require_permission("department.read"))],
)
async def list_departments(
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
    branch_id: UUID | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(100, ge=1, le=200),
) -> Page[DepartmentRead]:
    _resolved_company_id(user, tenant)
    stmt = select(Department)
    count_stmt = select(func.count(Department.id))
    if branch_id is not None:
        stmt = stmt.where(Department.branch_id == branch_id)
        count_stmt = count_stmt.where(Department.branch_id == branch_id)

    total = (await db.execute(count_stmt)).scalar_one()
    rows = (
        await db.execute(stmt.order_by(Department.name).offset((page - 1) * size).limit(size))
    ).scalars().all()
    return Page[DepartmentRead](
        items=[DepartmentRead.model_validate(r) for r in rows],
        total=total,
        page=page,
        size=size,
    )


@router.post(
    "",
    response_model=DepartmentRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("department.create"))],
)
async def create_department(
    data: DepartmentCreate,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> DepartmentRead:
    company_id = _resolved_company_id(user, tenant)
    dept = Department(company_id=company_id, **data.model_dump())
    db.add(dept)
    await db.commit()
    await db.refresh(dept)
    return DepartmentRead.model_validate(dept)


async def _get_dept(db, dept_id: UUID) -> Department:
    dept = (await db.execute(select(Department).where(Department.id == dept_id))).scalar_one_or_none()
    if not dept:
        raise NotFoundError("department.not_found")
    return dept


@router.get(
    "/{dept_id}",
    response_model=DepartmentRead,
    dependencies=[Depends(require_permission("department.read"))],
)
async def get_department(dept_id: UUID, user: CurrentUser, db: DbDep, tenant: TenantId) -> DepartmentRead:
    _resolved_company_id(user, tenant)
    return DepartmentRead.model_validate(await _get_dept(db, dept_id))


@router.patch(
    "/{dept_id}",
    response_model=DepartmentRead,
    dependencies=[Depends(require_permission("department.update"))],
)
async def update_department(
    dept_id: UUID,
    data: DepartmentUpdate,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> DepartmentRead:
    _resolved_company_id(user, tenant)
    dept = await _get_dept(db, dept_id)
    for f, v in data.model_dump(exclude_unset=True).items():
        setattr(dept, f, v)
    await db.commit()
    await db.refresh(dept)
    return DepartmentRead.model_validate(dept)


@router.delete(
    "/{dept_id}",
    response_model=MessageResponse,
    dependencies=[Depends(require_permission("department.delete"))],
)
async def delete_department(
    dept_id: UUID,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> MessageResponse:
    _resolved_company_id(user, tenant)
    dept = await _get_dept(db, dept_id)
    dept.is_active = False
    await db.commit()
    return MessageResponse(message="deactivated")
