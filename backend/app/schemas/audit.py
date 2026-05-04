"""Audit log schemas — read-only views over ``app.models.audit.AuditLog``."""
from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel

from app.schemas.common import ORMBase


class AuditLogRead(ORMBase):
    id: UUID
    company_id: UUID | None
    actor_id: UUID | None
    actor_role: str | None
    action: str
    resource_type: str | None
    resource_id: UUID | None
    ip_address: str | None
    user_agent: str | None
    payload: dict[str, Any] | None
    created_at: datetime
    # Joined fields surfaced for UI convenience — None when the actor row was
    # deleted (audit table uses ``ON DELETE SET NULL``).
    actor_username: str | None = None
    actor_full_name: str | None = None


class AuditLogActionStat(BaseModel):
    """One row of the ``/audit-logs/actions`` aggregate — used by the filter
    chips so the UI doesn't have to enumerate the action namespace."""

    action: str
    count: int


__all__ = ["AuditLogActionStat", "AuditLogRead"]
