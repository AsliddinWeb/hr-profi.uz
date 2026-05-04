"""User CRUD scoped to the caller's company.

OWNER cannot be created here — the only OWNER is the seeded one. EMPLOYEE
users are normally created via the Employee module (Phase 2) which provisions
a linked auth user. This endpoint is for HR_MANAGER / BRANCH_MANAGER /
COMPANY_ADMIN provisioning, plus password reset by an admin.
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import func, or_, select

from app.core.deps import CurrentUser, DbDep, TenantId, require_permission
from app.core.exceptions import (
    ConflictError,
    NotFoundError,
    PermissionDeniedError,
    ValidationAppError,
)
from app.core.permissions import Role
from app.core.security import hash_password
from app.models.user import User, UserStatus
from app.schemas.auth import PasswordResetRequest
from app.schemas.common import MessageResponse, Page
from app.schemas.user import UserCreate, UserRead, UserUpdate
from app.services import auth_service, audit_service

router = APIRouter(prefix="/users", tags=["users"])

# Roles a company-side caller is allowed to create. OWNER is excluded; DEVICE
# is provisioned via the Device flow in Phase 4. EMPLOYEE goes through the
# Employee module to keep the user/employee link consistent.
_CREATABLE_ROLES = {
    Role.COMPANY_ADMIN,
    Role.HR_MANAGER,
    Role.BRANCH_MANAGER,
}


def _resolved_company_id(user: User, tenant: UUID | None) -> UUID:
    cid = tenant or user.company_id
    if cid is None:
        raise PermissionDeniedError()
    return cid


@router.get(
    "",
    response_model=Page[UserRead],
    dependencies=[Depends(require_permission("user.read"))],
)
async def list_users(
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    role: Role | None = None,
    q: str | None = None,
    is_active: bool | None = None,
) -> Page[UserRead]:
    company_id = _resolved_company_id(user, tenant)

    # Bypass the tenant listener (User has no TenantMixin) and filter manually.
    stmt = (
        select(User)
        .where(User.company_id == company_id)
        .execution_options(skip_tenant_filter=True)
    )
    count_stmt = (
        select(func.count(User.id))
        .where(User.company_id == company_id)
        .execution_options(skip_tenant_filter=True)
    )
    if role is not None:
        stmt = stmt.where(User.role == role.value)
        count_stmt = count_stmt.where(User.role == role.value)
    if q:
        like = f"%{q.lower()}%"
        cond = or_(
            func.lower(User.username).like(like),
            func.lower(User.email).like(like),
            func.lower(User.full_name).like(like),
        )
        stmt = stmt.where(cond)
        count_stmt = count_stmt.where(cond)
    if is_active is not None:
        stmt = stmt.where(User.is_active.is_(is_active))
        count_stmt = count_stmt.where(User.is_active.is_(is_active))

    total = (await db.execute(count_stmt)).scalar_one()
    rows = (
        await db.execute(
            stmt.order_by(User.created_at.desc()).offset((page - 1) * size).limit(size)
        )
    ).scalars().all()

    return Page[UserRead](
        items=[UserRead.model_validate(r) for r in rows],
        total=total,
        page=page,
        size=size,
    )


@router.post(
    "",
    response_model=UserRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("user.create"))],
)
async def create_user(
    data: UserCreate,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> UserRead:
    company_id = _resolved_company_id(user, tenant)

    if data.role not in _CREATABLE_ROLES:
        raise ValidationAppError("user.role_not_creatable_here")

    # Branch link is mandatory for BRANCH_MANAGER (their whole authorization
    # surface depends on it). Reject the create otherwise to avoid leaving a
    # half-configured BM that can't see anything until an admin remembers to
    # patch them.
    if data.role == Role.BRANCH_MANAGER and data.branch_id is None:
        raise ValidationAppError("user.branch_required_for_manager")

    # Prevent username/email collision within the same tenant.
    exists_q = (
        select(User.id)
        .where(
            User.company_id == company_id,
            or_(
                User.username == data.username,
                (User.email == data.email) if data.email else False,
            ),
        )
        .execution_options(skip_tenant_filter=True)
    )
    if (await db.execute(exists_q)).scalar_one_or_none():
        raise ConflictError("user.duplicate")

    new_user = User(
        company_id=company_id,
        branch_id=data.branch_id if data.role == Role.BRANCH_MANAGER else None,
        username=data.username,
        email=data.email,
        password_hash=hash_password(data.password),
        role=data.role,
        status=UserStatus.ACTIVE,
        full_name=data.full_name,
        phone=data.phone,
        language=data.language,
        is_active=True,
    )
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)
    await audit_service.record(
        db,
        action="user.create",
        actor_id=user.id,
        actor_role=user.role,
        company_id=company_id,
        resource_type="user",
        resource_id=new_user.id,
        payload={"role": data.role.value, "username": data.username},
        commit=True,
    )
    return UserRead.model_validate(new_user)


async def _get_user_in_tenant(db, user_id: UUID, company_id: UUID) -> User:
    stmt = (
        select(User)
        .where(User.id == user_id, User.company_id == company_id)
        .execution_options(skip_tenant_filter=True)
    )
    target = (await db.execute(stmt)).scalar_one_or_none()
    if not target:
        raise NotFoundError("user.not_found")
    return target


@router.get(
    "/{user_id}",
    response_model=UserRead,
    dependencies=[Depends(require_permission("user.read"))],
)
async def get_user(
    user_id: UUID,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> UserRead:
    company_id = _resolved_company_id(user, tenant)
    return UserRead.model_validate(await _get_user_in_tenant(db, user_id, company_id))


@router.patch(
    "/{user_id}",
    response_model=UserRead,
    dependencies=[Depends(require_permission("user.update"))],
)
async def update_user(
    user_id: UUID,
    data: UserUpdate,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> UserRead:
    company_id = _resolved_company_id(user, tenant)
    target = await _get_user_in_tenant(db, user_id, company_id)
    payload = data.model_dump(exclude_unset=True)

    # Self-protection: an admin can't accidentally demote/lock themselves out.
    if target.id == user.id:
        if "is_active" in payload and not payload["is_active"]:
            raise ValidationAppError("user.cannot_deactivate_self")
        if "role" in payload and payload["role"] != target.role:
            raise ValidationAppError("user.cannot_change_own_role")
        if "status" in payload and payload["status"] in (
            UserStatus.SUSPENDED,
            UserStatus.TERMINATED,
            UserStatus.SUSPENDED.value,
            UserStatus.TERMINATED.value,
        ):
            raise ValidationAppError("user.cannot_suspend_self")

    # branch_id is meaningful only for BRANCH_MANAGER; silently drop it from
    # the payload otherwise so a stray UI value can't leave a non-BM with a
    # branch pin (which would do nothing today, but could surprise audits).
    if "branch_id" in payload and target.role != Role.BRANCH_MANAGER:
        payload.pop("branch_id")
    # Don't allow PATCH to clear a BRANCH_MANAGER's branch_id — that would
    # lock them out of every endpoint silently. Re-assignment to another
    # branch is allowed (set to a different non-null UUID).
    if (
        target.role == Role.BRANCH_MANAGER
        and "branch_id" in payload
        and payload["branch_id"] is None
    ):
        raise ValidationAppError("user.branch_required_for_manager")

    for field, value in payload.items():
        setattr(target, field, value)
    await db.commit()
    await db.refresh(target)
    return UserRead.model_validate(target)


@router.post(
    "/{user_id}/reset-password",
    response_model=MessageResponse,
    dependencies=[Depends(require_permission("user.update"))],
)
async def reset_user_password(
    user_id: UUID,
    data: PasswordResetRequest,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> MessageResponse:
    if data.user_id != user_id:
        raise ValidationAppError()
    company_id = _resolved_company_id(user, tenant)
    target = await _get_user_in_tenant(db, user_id, company_id)
    await auth_service.reset_password_admin(db, target, new_password=data.new_password)
    await audit_service.record(
        db,
        action="user.reset_password",
        actor_id=user.id,
        actor_role=user.role,
        company_id=company_id,
        resource_type="user",
        resource_id=target.id,
        commit=True,
    )
    return MessageResponse(message="password_reset")


@router.delete(
    "/{user_id}",
    response_model=MessageResponse,
    dependencies=[Depends(require_permission("user.delete"))],
)
async def delete_user(
    user_id: UUID,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
    hard: bool = Query(
        False,
        description="When true, permanently delete the row (refused if Employee/audit FK blocks).",
    ),
) -> MessageResponse:
    """Soft-delete (default) or hard-delete a user.

    Soft → ``is_active=False`` and ``status=SUSPENDED`` (reversible via
    ``/reactivate``). Hard → DB row removed, but the call refuses if the
    user is linked to an Employee record (deleting would orphan attendance,
    salary, KPI rows). Admin must move the employee to a different account
    or hard-delete the employee first.
    """
    if user_id == user.id:
        raise ValidationAppError("user.cannot_deactivate_self")
    company_id = _resolved_company_id(user, tenant)
    target = await _get_user_in_tenant(db, user_id, company_id)
    if target.role == Role.OWNER.value:
        raise ValidationAppError("user.cannot_delete_owner")

    if hard:
        # Refuse if this user backs an Employee — deleting would cascade
        # into attendance/salary/KPI history. Force admin to handle the
        # Employee side first.
        from app.models.employee import Employee

        emp = (
            await db.execute(
                select(Employee.id)
                .where(Employee.user_id == target.id)
                .execution_options(skip_tenant_filter=True)
            )
        ).scalar_one_or_none()
        if emp is not None:
            raise ValidationAppError("user.linked_to_employee")
        await audit_service.record(
            db,
            action="user.hard_delete",
            actor_id=user.id,
            actor_role=user.role,
            company_id=company_id,
            resource_type="user",
            resource_id=target.id,
            payload={"username": target.username, "role": target.role},
            commit=False,
        )
        await db.delete(target)
        await db.commit()
        return MessageResponse(message="deleted")

    target.is_active = False
    target.status = UserStatus.SUSPENDED
    await db.commit()
    await audit_service.record(
        db,
        action="user.deactivate",
        actor_id=user.id,
        actor_role=user.role,
        company_id=company_id,
        resource_type="user",
        resource_id=target.id,
        commit=True,
    )
    return MessageResponse(message="deactivated")


@router.post(
    "/{user_id}/reactivate",
    response_model=UserRead,
    dependencies=[Depends(require_permission("user.update"))],
)
async def reactivate_user(
    user_id: UUID,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> UserRead:
    """Bring a deactivated user back: ``is_active=True`` + ``status=ACTIVE``."""
    company_id = _resolved_company_id(user, tenant)
    target = await _get_user_in_tenant(db, user_id, company_id)
    target.is_active = True
    if target.status in (
        UserStatus.SUSPENDED,
        UserStatus.SUSPENDED.value,
        UserStatus.INVITED,
        UserStatus.INVITED.value,
    ):
        target.status = UserStatus.ACTIVE
    await db.commit()
    await db.refresh(target)
    await audit_service.record(
        db,
        action="user.reactivate",
        actor_id=user.id,
        actor_role=user.role,
        company_id=company_id,
        resource_type="user",
        resource_id=target.id,
        commit=True,
    )
    return UserRead.model_validate(target)
