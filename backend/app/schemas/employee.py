"""Employee schemas."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field

from app.models.employee import Gender, SalaryType, WorkType
from app.schemas.common import ORMBase


class EmployeeCreate(BaseModel):
    branch_id: UUID | None = None
    department_id: UUID | None = None

    employee_code: str = Field(min_length=1, max_length=64)
    full_name: str = Field(min_length=1, max_length=200)
    photo_url: str | None = Field(default=None, max_length=500)
    phone: str | None = Field(default=None, max_length=32)
    email: EmailStr | None = None
    position: str | None = Field(default=None, max_length=200)
    hire_date: date | None = None
    birth_date: date | None = None
    gender: Gender | None = None
    passport: str | None = Field(default=None, max_length=64)
    inn: str | None = Field(default=None, max_length=32)
    address: str | None = Field(default=None, max_length=500)

    emergency_contact_name: str | None = Field(default=None, max_length=200)
    emergency_contact_phone: str | None = Field(default=None, max_length=32)
    emergency_contact_relation: str | None = Field(default=None, max_length=64)

    bank_card_number: str | None = Field(default=None, max_length=32)
    bank_name: str | None = Field(default=None, max_length=120)
    notes: str | None = None

    work_type: WorkType = WorkType.FIXED_SHIFT
    shift_template_id: UUID | None = None

    salary_type: SalaryType = SalaryType.MONTHLY
    base_salary: Decimal | None = Field(default=None, ge=0)
    hourly_rate: Decimal | None = Field(default=None, ge=0)
    daily_rate: Decimal | None = Field(default=None, ge=0)
    overtime_multiplier: Decimal = Field(default=Decimal("1.5"), ge=0, le=10)

    # Auth user provisioning. If both are set, an EMPLOYEE-role user is
    # created and linked. If neither, the employee has no login (e.g. a
    # contractor tracked only via face-id device).
    create_login: bool = False
    login_username: str | None = Field(default=None, min_length=2, max_length=64)
    login_password: str | None = Field(default=None, min_length=8, max_length=128)


class EmployeeUpdate(BaseModel):
    branch_id: UUID | None = None
    department_id: UUID | None = None
    full_name: str | None = Field(default=None, max_length=200)
    photo_url: str | None = Field(default=None, max_length=500)
    phone: str | None = Field(default=None, max_length=32)
    email: EmailStr | None = None
    position: str | None = Field(default=None, max_length=200)
    hire_date: date | None = None
    birth_date: date | None = None
    gender: Gender | None = None
    passport: str | None = Field(default=None, max_length=64)
    inn: str | None = Field(default=None, max_length=32)
    address: str | None = Field(default=None, max_length=500)
    emergency_contact_name: str | None = Field(default=None, max_length=200)
    emergency_contact_phone: str | None = Field(default=None, max_length=32)
    emergency_contact_relation: str | None = Field(default=None, max_length=64)
    bank_card_number: str | None = Field(default=None, max_length=32)
    bank_name: str | None = Field(default=None, max_length=120)
    notes: str | None = None
    work_type: WorkType | None = None
    shift_template_id: UUID | None = None
    salary_type: SalaryType | None = None
    base_salary: Decimal | None = Field(default=None, ge=0)
    hourly_rate: Decimal | None = Field(default=None, ge=0)
    daily_rate: Decimal | None = Field(default=None, ge=0)
    overtime_multiplier: Decimal | None = Field(default=None, ge=0, le=10)
    is_active: bool | None = None
    termination_reason: str | None = Field(default=None, max_length=500)


class EmployeeRead(ORMBase):
    id: UUID
    company_id: UUID
    branch_id: UUID | None
    department_id: UUID | None
    user_id: UUID | None
    employee_code: str
    full_name: str
    photo_url: str | None
    phone: str | None
    email: str | None
    position: str | None
    hire_date: date | None
    birth_date: date | None
    gender: Gender | None
    passport: str | None
    inn: str | None
    address: str | None
    emergency_contact_name: str | None
    emergency_contact_phone: str | None
    emergency_contact_relation: str | None
    bank_card_number: str | None
    bank_name: str | None
    notes: str | None
    work_type: WorkType
    shift_template_id: UUID | None
    salary_type: SalaryType
    base_salary: Decimal | None
    hourly_rate: Decimal | None
    daily_rate: Decimal | None
    overtime_multiplier: Decimal
    is_active: bool
    terminated_at: datetime | None
    created_at: datetime
    updated_at: datetime


class EmployeeBulkImportResult(BaseModel):
    created: int
    skipped: int
    errors: list[dict]


__all__ = [
    "EmployeeBulkImportResult",
    "EmployeeCreate",
    "EmployeeRead",
    "EmployeeUpdate",
]
