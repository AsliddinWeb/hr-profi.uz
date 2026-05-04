"""Append-only audit logging."""
from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditLog


async def record(
    db: AsyncSession,
    *,
    action: str,
    actor_id: UUID | None = None,
    actor_role: str | None = None,
    company_id: UUID | None = None,
    resource_type: str | None = None,
    resource_id: UUID | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
    payload: dict[str, Any] | None = None,
    commit: bool = False,
) -> None:
    """Insert an audit row. By default we don't commit — caller batches with
    its own transaction. Set ``commit=True`` for fire-and-forget audit (e.g.
    failed login attempt where there's no other write)."""
    db.add(
        AuditLog(
            action=action,
            actor_id=actor_id,
            actor_role=actor_role,
            company_id=company_id,
            resource_type=resource_type,
            resource_id=resource_id,
            ip_address=ip_address,
            user_agent=user_agent,
            payload=payload,
        )
    )
    if commit:
        await db.commit()


__all__ = ["record"]
