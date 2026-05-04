"""Tenant scoping primitives.

Every tenant-scoped model inherits ``TenantMixin``. A SQLAlchemy ``do_orm_execute``
event listener inspects the current ``ContextVar`` (set by FastAPI dep
``get_current_tenant``) and injects ``WHERE company_id = :tenant_id`` on every
SELECT against tenant tables — unless the caller explicitly opts out (Owner cross-
tenant queries) by setting ``execution_options(skip_tenant_filter=True)``.

This is the linchpin of multi-tenant safety. Bypassing it requires explicit intent.
"""
from __future__ import annotations

from contextvars import ContextVar
from uuid import UUID

from sqlalchemy import event
from sqlalchemy.orm import ORMExecuteState, with_loader_criteria

from app.models.base import TenantMixin

# Set by FastAPI auth dependency at the start of every request.
# OWNER + bare /auth endpoints leave it None.
_current_tenant: ContextVar[UUID | None] = ContextVar("current_tenant", default=None)


def set_current_tenant(company_id: UUID | None) -> None:
    _current_tenant.set(company_id)


def get_current_tenant() -> UUID | None:
    return _current_tenant.get()


_listener_installed = False


def install_tenant_listener() -> None:
    """Register the global ORM-level filter. Idempotent — safe to call from
    both the FastAPI lifespan and pytest fixtures."""
    global _listener_installed
    if _listener_installed:
        return

    from sqlalchemy.orm import Session

    @event.listens_for(Session, "do_orm_execute")
    def _do_orm_execute(state: ORMExecuteState) -> None:
        if not (state.is_select or state.is_update or state.is_delete):
            return
        if state.execution_options.get("skip_tenant_filter"):
            return
        tenant_id = _current_tenant.get()
        if tenant_id is None:
            # Either an Owner cross-tenant call (must opt out explicitly) or a
            # pre-auth call (login). In both cases the caller is responsible.
            return
        state.statement = state.statement.options(
            with_loader_criteria(
                TenantMixin,
                lambda cls: cls.company_id == tenant_id,
                include_aliases=True,
            )
        )

    _listener_installed = True


__all__ = [
    "get_current_tenant",
    "install_tenant_listener",
    "set_current_tenant",
]
