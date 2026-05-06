"""Employee — the unit of HR/payroll.

Each Employee links to a User (auth principal). For now we provision both
together in the create endpoint; future Phase 2.5 may decouple them so an
employee can exist without an auth user (e.g., contractors who never log in).

Tenant-scoped via ``TenantMixin``. Soft-delete via ``terminated_at``.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    LargeBinary,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TenantMixin, TimestampMixin

if TYPE_CHECKING:
    from app.models.branch import Branch
    from app.models.department import Department
    from app.models.user import User


class WorkType(StrEnum):
    FIXED_SHIFT = "FIXED_SHIFT"
    FLEXIBLE = "FLEXIBLE"
    HYBRID = "HYBRID"


class SalaryType(StrEnum):
    MONTHLY = "MONTHLY"
    HOURLY = "HOURLY"
    DAILY = "DAILY"
    KPI_BASED = "KPI_BASED"


class Gender(StrEnum):
    MALE = "MALE"
    FEMALE = "FEMALE"
    OTHER = "OTHER"


class Employee(Base, TenantMixin, TimestampMixin):
    __tablename__ = "employees"
    __table_args__ = (
        UniqueConstraint("company_id", "employee_code", name="uq_employees_company_code"),
    )

    branch_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("branches.id", ondelete="SET NULL"),
        index=True,
    )
    department_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("departments.id", ondelete="SET NULL"),
        index=True,
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        index=True,
        unique=True,
    )

    employee_code: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    photo_url: Mapped[str | None] = mapped_column(String(500))

    phone: Mapped[str | None] = mapped_column(String(32))
    email: Mapped[str | None] = mapped_column(String(255))
    position: Mapped[str | None] = mapped_column(String(200))
    hire_date: Mapped[date | None] = mapped_column(Date)
    birth_date: Mapped[date | None] = mapped_column(Date)
    gender: Mapped[Gender | None] = mapped_column(String(8))
    passport: Mapped[str | None] = mapped_column(String(64))
    inn: Mapped[str | None] = mapped_column(String(32))
    address: Mapped[str | None] = mapped_column(String(500))

    # Emergency contact — stored flat to keep payroll exports trivial.
    emergency_contact_name: Mapped[str | None] = mapped_column(String(200))
    emergency_contact_phone: Mapped[str | None] = mapped_column(String(32))
    emergency_contact_relation: Mapped[str | None] = mapped_column(String(64))

    # Payroll metadata (free-text — bank routing rules vary per company)
    bank_card_number: Mapped[str | None] = mapped_column(String(32))
    bank_name: Mapped[str | None] = mapped_column(String(120))

    notes: Mapped[str | None] = mapped_column(Text)

    # Work setup
    work_type: Mapped[WorkType] = mapped_column(
        String(16), default=WorkType.FIXED_SHIFT.value, nullable=False
    )
    shift_template_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("shift_templates.id", ondelete="SET NULL"),
        index=True,
    )

    # Compensation
    salary_type: Mapped[SalaryType] = mapped_column(
        String(16), default=SalaryType.MONTHLY.value, nullable=False
    )
    base_salary: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    hourly_rate: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    daily_rate: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    overtime_multiplier: Mapped[Decimal] = mapped_column(
        Numeric(4, 2), default=Decimal("1.5"), nullable=False
    )

    # Hikvision-style face_id_template_id (legacy device handshake) —
    # kept around for the Face-ID hardware path.
    face_template_id: Mapped[str | None] = mapped_column(String(255))

    # Server-side face recognition for the kiosk path (Phase 4).
    # ``face_embedding`` is the raw bytes of a 128-d float64 numpy array
    # produced by face_recognition.face_encodings(). ``face_enrolled_at``
    # is set whenever the embedding is computed/refreshed so the admin
    # UI can show a "face enrolled" badge and the backfill task can
    # skip employees that are already up to date.
    face_embedding: Mapped[bytes | None] = mapped_column(LargeBinary)
    face_enrolled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    terminated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    termination_reason: Mapped[str | None] = mapped_column(String(500))

    # Relationships — kept lazy to avoid touching the listener.
    branch: Mapped["Branch | None"] = relationship()
    department: Mapped["Department | None"] = relationship()
    user: Mapped["User | None"] = relationship()

    def __repr__(self) -> str:
        return f"<Employee code={self.employee_code!r} name={self.full_name!r}>"
