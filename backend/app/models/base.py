"""Declarative base + reusable mixins.

``TenantMixin`` is the marker the tenant event listener looks for. Every
table that holds tenant data MUST inherit it. Global tables (Company,
Owner-level User) must not.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, declared_attr, mapped_column


class Base(DeclarativeBase):
    """Project-wide declarative base.

    Subclasses get ``id`` (UUID PK) by default; override if you need a different
    primary key (composite, sequence, etc.).
    """

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class TenantMixin:
    """Marks a table as tenant-scoped.

    The class-level ``__tenant__`` flag is what the listener inspects (cheaper
    than a runtime isinstance check on every loaded entity). Subclasses get
    ``company_id`` automatically.
    """

    __tenant__ = True

    @declared_attr
    @classmethod
    def company_id(cls) -> Mapped[uuid.UUID]:
        return mapped_column(
            PGUUID(as_uuid=True),
            ForeignKey("companies.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        )


__all__ = ["Base", "TenantMixin", "TimestampMixin"]
