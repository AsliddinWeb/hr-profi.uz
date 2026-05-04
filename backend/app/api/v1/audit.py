"""Read-only audit log viewer.

Tenant scoping: ``company_id`` is nullable on ``audit_logs`` (Owner-level
actions are global). For non-Owner callers we filter by their own
``company_id``; for Owners we accept an optional ``company_id`` query.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import desc, func, select
from sqlalchemy.orm import aliased

from app.core.deps import CurrentUser, DbDep, TenantId, require_permission
from app.core.exceptions import PermissionDeniedError
from app.core.permissions import Role
from app.models.audit import AuditLog
from app.models.user import User
from app.schemas.audit import AuditLogActionStat, AuditLogRead
from app.schemas.common import Page

router = APIRouter(tags=["audit"])


def _company_filter(user, tenant: UUID | None) -> UUID | None:
    """Owner sees everything (or a specific company when ``?company_id`` is
    passed via the tenant header). Everyone else is locked to their own
    company. Returns the company_id to filter by, or ``None`` for "all"."""
    if user.role == Role.OWNER:
        return tenant  # may be None → no filter
    if user.company_id is None:
        raise PermissionDeniedError()
    return user.company_id


@router.get(
    "/audit-logs",
    response_model=Page[AuditLogRead],
    dependencies=[Depends(require_permission("audit.read"))],
)
async def list_audit_logs(
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    action: str | None = Query(None, max_length=64),
    actor_id: UUID | None = None,
    resource_type: str | None = Query(None, max_length=64),
    resource_id: UUID | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
    q: str | None = Query(None, max_length=200),
) -> Page[AuditLogRead]:
    """Paginated audit log feed.

    Why join the actor here instead of letting the frontend resolve user IDs?
    We already have the company_id pin — adding a single LEFT JOIN avoids the
    N+1 the frontend would otherwise have to do, and the audit page is the
    single noisiest place a user_id → username lookup happens.
    """
    company_id = _company_filter(user, tenant)

    actor = aliased(User)
    stmt = (
        select(AuditLog, actor.username, actor.full_name)
        .join(actor, actor.id == AuditLog.actor_id, isouter=True)
        .order_by(desc(AuditLog.created_at))
    )
    count_stmt = select(func.count(AuditLog.id))

    if company_id is not None:
        stmt = stmt.where(AuditLog.company_id == company_id)
        count_stmt = count_stmt.where(AuditLog.company_id == company_id)
    if action:
        # Allow either an exact match or an `auth.*`-style prefix.
        if action.endswith(".*"):
            prefix = action[:-2]
            stmt = stmt.where(AuditLog.action.startswith(prefix + "."))
            count_stmt = count_stmt.where(AuditLog.action.startswith(prefix + "."))
        else:
            stmt = stmt.where(AuditLog.action == action)
            count_stmt = count_stmt.where(AuditLog.action == action)
    if actor_id is not None:
        stmt = stmt.where(AuditLog.actor_id == actor_id)
        count_stmt = count_stmt.where(AuditLog.actor_id == actor_id)
    if resource_type:
        stmt = stmt.where(AuditLog.resource_type == resource_type)
        count_stmt = count_stmt.where(AuditLog.resource_type == resource_type)
    if resource_id is not None:
        stmt = stmt.where(AuditLog.resource_id == resource_id)
        count_stmt = count_stmt.where(AuditLog.resource_id == resource_id)
    if since is not None:
        stmt = stmt.where(AuditLog.created_at >= since)
        count_stmt = count_stmt.where(AuditLog.created_at >= since)
    if until is not None:
        stmt = stmt.where(AuditLog.created_at <= until)
        count_stmt = count_stmt.where(AuditLog.created_at <= until)
    if q:
        # Cheap "free text" — matches against action and the joined actor
        # username. No payload search yet because that requires JSONB
        # operators that we'd want to gate behind a GIN index.
        like = f"%{q}%"
        stmt = stmt.where(AuditLog.action.ilike(like) | actor.username.ilike(like))
        count_stmt = count_stmt.join(
            actor, actor.id == AuditLog.actor_id, isouter=True
        ).where(AuditLog.action.ilike(like) | actor.username.ilike(like))

    total = (await db.execute(count_stmt)).scalar_one()
    rows = (await db.execute(stmt.offset((page - 1) * size).limit(size))).all()

    items: list[AuditLogRead] = []
    for log, username, full_name in rows:
        item = AuditLogRead.model_validate(log)
        item.actor_username = username
        item.actor_full_name = full_name
        items.append(item)
    return Page[AuditLogRead](items=items, total=total, page=page, size=size)


@router.get(
    "/audit-logs/actions",
    response_model=list[AuditLogActionStat],
    dependencies=[Depends(require_permission("audit.read"))],
)
async def list_audit_actions(
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
    days: int = Query(30, ge=1, le=365),
) -> list[AuditLogActionStat]:
    """Distinct ``action`` values with counts over the last N days. Powers
    the filter dropdown so the UI doesn't have to know the action namespace."""
    company_id = _company_filter(user, tenant)
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    stmt = (
        select(AuditLog.action, func.count(AuditLog.id))
        .where(AuditLog.created_at >= cutoff)
        .group_by(AuditLog.action)
        .order_by(func.count(AuditLog.id).desc())
        .limit(80)
    )
    if company_id is not None:
        stmt = stmt.where(AuditLog.company_id == company_id)

    rows = (await db.execute(stmt)).all()
    return [AuditLogActionStat(action=a, count=c) for a, c in rows]
