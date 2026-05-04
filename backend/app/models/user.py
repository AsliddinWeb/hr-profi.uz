"""User — the auth principal.

OWNER users have ``company_id = NULL`` (system-wide). Everyone else belongs to
a single company. We deliberately don't put ``TenantMixin`` on User because:
  1. Owner needs to live outside any tenant.
  2. The login flow needs to look up users *before* the tenant ContextVar is
     set, which would clash with the listener.

Cross-tenant access for User is enforced manually in the auth/owner routers.
"""
from __future__ import annotations

import uuid
from enum import StrEnum
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.permissions import Role
from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.company import Company


class UserStatus(StrEnum):
    ACTIVE = "ACTIVE"
    INVITED = "INVITED"
    SUSPENDED = "SUSPENDED"
    TERMINATED = "TERMINATED"


class User(Base, TimestampMixin):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("company_id", "username", name="uq_users_company_username"),
        UniqueConstraint("company_id", "email", name="uq_users_company_email"),
    )

    company_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="CASCADE"),
        nullable=True,  # Owner users have NULL.
        index=True,
    )

    # Set for BRANCH_MANAGER users — pins them to a single branch so the
    # ``apply_branch_scope`` helper can filter queries by it. NULL for any
    # other role (CA/HR/Owner are company-wide; EMPLOYEE/DEVICE branch is
    # tracked on the linked Employee row).
    branch_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("branches.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    username: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    email: Mapped[str | None] = mapped_column(String(255), index=True)

    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[Role] = mapped_column(String(32), nullable=False)
    status: Mapped[UserStatus] = mapped_column(
        String(16), default=UserStatus.ACTIVE.value, nullable=False
    )

    full_name: Mapped[str | None] = mapped_column(String(200))
    phone: Mapped[str | None] = mapped_column(String(32))
    language: Mapped[str] = mapped_column(String(2), default="uz", nullable=False)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    two_factor_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    company: Mapped["Company | None"] = relationship(back_populates="users")

    def __repr__(self) -> str:
        return f"<User {self.username!r} role={self.role}>"
