"""FastAPI dependencies: auth, current user, tenant scoping, permission guards."""
from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Annotated
from uuid import UUID

from fastapi import Depends, Header, Query, Request
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.exceptions import (
    AuthenticationError,
    PermissionDeniedError,
    TenantMismatchError,
    TokenError,
)
from app.core.i18n import detect_lang
from app.core.permissions import Role, has_permission
from app.core.security import ACCESS_TOKEN_TYPE, JWTError, decode_token
from app.core.tenant import set_current_tenant
from app.database import get_db
from app.models.user import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.api_v1_prefix}/auth/login", auto_error=False)


# --- Language --------------------------------------------------------------------

async def language_dep(request: Request) -> str:
    lang = detect_lang(request)
    request.state.lang = lang
    return lang


LangDep = Annotated[str, Depends(language_dep)]


# --- DB --------------------------------------------------------------------------

DbDep = Annotated[AsyncSession, Depends(get_db)]


# --- Current user ---------------------------------------------------------------

async def get_current_user(
    request: Request,
    db: DbDep,
    token: Annotated[str | None, Depends(oauth2_scheme)] = None,
) -> User:
    if not token:
        raise AuthenticationError()
    try:
        payload = decode_token(token)
    except JWTError as e:
        raise TokenError() from e

    if payload.get("type") != ACCESS_TOKEN_TYPE:
        raise TokenError("auth.invalid_token_type")

    sub = payload.get("sub")
    if not sub:
        raise TokenError()

    try:
        user_id = UUID(sub)
    except (TypeError, ValueError) as e:
        raise TokenError() from e

    # Owner doesn't have a company_id; for everyone else tenant filter would
    # block the SELECT, so we opt out for this single bootstrapping query.
    stmt = select(User).where(User.id == user_id).execution_options(skip_tenant_filter=True)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise AuthenticationError()

    # Pin the user + role on request.state so downstream code can read it
    # without re-decoding.
    request.state.user = user
    request.state.role = user.role
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


# --- Tenant scoping --------------------------------------------------------------

async def tenant_scope(
    user: CurrentUser,
    company_id_q: Annotated[UUID | None, Query(alias="company_id")] = None,
) -> UUID | None:
    """Sets the current tenant ContextVar for the duration of the request.

    - OWNER may pass ?company_id=X to scope queries to a specific company; without
      it, OWNER queries are *unscoped* (the listener will not filter).
    - Everyone else is scoped to their own ``user.company_id`` regardless of what
      they pass; passing a different ID is a hard error.
    """
    if user.role == Role.OWNER:
        set_current_tenant(company_id_q)
        return company_id_q

    if company_id_q is not None and company_id_q != user.company_id:
        raise TenantMismatchError()

    set_current_tenant(user.company_id)
    return user.company_id


TenantId = Annotated[UUID | None, Depends(tenant_scope)]


# --- Branch scope (BRANCH_MANAGER) ----------------------------------------------

async def current_branch_id(user: CurrentUser) -> UUID | None:
    """Return ``user.branch_id`` for BRANCH_MANAGER users; ``None`` for others.

    Why we don't error when a BM has no ``branch_id``: that would lock a
    misconfigured BM out of every endpoint until an admin assigns one.
    Returning ``None`` keeps requests reaching the endpoint, where business
    logic can present a clearer "no branch assigned" message. Endpoints that
    *strictly* require a branch (e.g. KPI approve) should call
    ``require_branch_assigned`` below.
    """
    if user.role == Role.BRANCH_MANAGER:
        return user.branch_id
    return None


BranchId = Annotated["UUID | None", Depends(current_branch_id)]


async def require_branch_assigned(user: CurrentUser) -> UUID:
    """Use on endpoints where a BM must be branch-pinned to act (decision
    flows, etc.). Non-BM callers pass through unchanged with an UUID-like
    sentinel raised by tenant scope, so this dep should be combined with
    ``require_permission`` to keep the role guard explicit.
    """
    if user.role == Role.BRANCH_MANAGER and user.branch_id is None:
        raise PermissionDeniedError("auth.branch_not_assigned")
    return user.branch_id  # type: ignore[return-value]


def apply_branch_scope(stmt, user: User, branch_column):
    """Append ``WHERE branch_column = user.branch_id`` for BRANCH_MANAGER.

    No-op for OWNER/CA/HR — they're trusted to span the company. Pass the
    actual SQLAlchemy column you want filtered (typically
    ``Employee.branch_id`` or ``AttendanceRecord.branch_id``); we don't
    introspect because some tables join through Employee and the caller
    knows the right anchor."""
    if user.role == Role.BRANCH_MANAGER and user.branch_id is not None:
        return stmt.where(branch_column == user.branch_id)
    return stmt


# --- Permission guard ------------------------------------------------------------

def require_permission(*permissions: str):
    """Dependency factory.

    Usage:
        @router.post("/employees", dependencies=[Depends(require_permission("employee.create"))])
    """

    async def _guard(user: CurrentUser) -> None:
        if not all(has_permission(user.role, p) for p in permissions):
            raise PermissionDeniedError()

    return _guard


def require_role(*roles: Role):
    async def _guard(user: CurrentUser) -> None:
        if user.role not in roles:
            raise PermissionDeniedError()

    return _guard


# --- Convenience: Owner-only ----------------------------------------------------

async def require_owner(user: CurrentUser) -> User:
    if user.role != Role.OWNER:
        raise PermissionDeniedError()
    return user


OwnerUser = Annotated[User, Depends(require_owner)]


# --- Header helpers --------------------------------------------------------------

async def user_agent(user_agent: Annotated[str | None, Header()] = None) -> str | None:
    return user_agent


async def client_ip(request: Request) -> str | None:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else None


__all__ = [
    "BranchId",
    "CurrentUser",
    "DbDep",
    "LangDep",
    "OwnerUser",
    "TenantId",
    "apply_branch_scope",
    "client_ip",
    "current_branch_id",
    "get_current_user",
    "language_dep",
    "require_branch_assigned",
    "require_owner",
    "require_permission",
    "require_role",
    "user_agent",
]
