"""Department — optional tree under Branch. Tenant-scoped."""
from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TenantMixin, TimestampMixin

if TYPE_CHECKING:
    from app.models.branch import Branch


class Department(Base, TenantMixin, TimestampMixin):
    __tablename__ = "departments"

    branch_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("branches.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("departments.id", ondelete="CASCADE"),
        index=True,
    )

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    code: Mapped[str | None] = mapped_column(String(64))
    description: Mapped[str | None] = mapped_column(String(500))

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    branch: Mapped["Branch"] = relationship(back_populates="departments")
    parent: Mapped["Department | None"] = relationship(
        remote_side="Department.id", back_populates="children"
    )
    children: Mapped[list["Department"]] = relationship(
        back_populates="parent", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Department {self.name!r}>"
