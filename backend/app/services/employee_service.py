"""Employee creation/import services.

Pulls the auth-user provisioning logic out of the router so the bulk import
path can reuse it.
"""
from __future__ import annotations

import re
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConflictError, ValidationAppError
from app.core.permissions import Role
from app.core.security import hash_password
from app.models.company import Company
from app.models.employee import Employee
from app.models.user import User, UserStatus
from app.schemas.employee import EmployeeCreate


def _company_employee_prefix(company: Company) -> str:
    explicit = (getattr(company, "employee_code_prefix", None) or "").strip()
    if explicit:
        return explicit
    slug = (company.slug or "").strip()
    if not slug:
        return "emp"
    first = slug.split("-", 1)[0] or slug
    return first[:16] or "emp"


async def _employee_code_exists(db: AsyncSession, company_id: UUID, code: str) -> bool:
    stmt = (
        select(Employee.id)
        .where(Employee.company_id == company_id, Employee.employee_code == code)
        .execution_options(skip_tenant_filter=True)
    )
    return (await db.execute(stmt)).scalar_one_or_none() is not None


async def _username_exists(db: AsyncSession, company_id: UUID, username: str) -> bool:
    stmt = (
        select(User.id)
        .where(User.company_id == company_id, User.username == username)
        .execution_options(skip_tenant_filter=True)
    )
    return (await db.execute(stmt)).scalar_one_or_none() is not None


async def create_employee(
    db: AsyncSession,
    company_id: UUID,
    data: EmployeeCreate,
) -> Employee:
    if await _employee_code_exists(db, company_id, data.employee_code):
        raise ConflictError("employee.code_taken")

    # Bump the per-company counter so the next /next-code call doesn't
    # hand back a code we just used. Load the company row inside the
    # same transaction so concurrent creates ratchet the counter
    # forward together (postgres serialises the UPDATE, last write wins
    # past the highest observed seq).
    company = (
        await db.execute(
            select(Company)
            .where(Company.id == company_id)
            .execution_options(skip_tenant_filter=True)
        )
    ).scalar_one()
    prefix = _company_employee_prefix(company)
    suffix_match = re.match(rf"^{re.escape(prefix)}-(\d+)$", data.employee_code)
    if suffix_match:
        n = int(suffix_match.group(1))
        if n + 1 > int(company.next_employee_seq or 1):
            company.next_employee_seq = n + 1

    user_id: UUID | None = None
    if data.create_login:
        if not data.login_username or not data.login_password:
            raise ValidationAppError("employee.login_credentials_required")
        if await _username_exists(db, company_id, data.login_username):
            raise ConflictError("user.duplicate")
        login_user = User(
            company_id=company_id,
            username=data.login_username,
            email=data.email,
            password_hash=hash_password(data.login_password),
            role=Role.EMPLOYEE,
            status=UserStatus.ACTIVE,
            full_name=data.full_name,
            phone=data.phone,
            is_active=True,
            language="uz",
        )
        db.add(login_user)
        await db.flush()
        user_id = login_user.id

    employee = Employee(
        company_id=company_id,
        branch_id=data.branch_id,
        department_id=data.department_id,
        user_id=user_id,
        employee_code=data.employee_code,
        full_name=data.full_name,
        photo_url=data.photo_url,
        phone=data.phone,
        email=data.email,
        position=data.position,
        hire_date=data.hire_date,
        birth_date=data.birth_date,
        gender=data.gender,
        passport=data.passport,
        inn=data.inn,
        address=data.address,
        emergency_contact_name=data.emergency_contact_name,
        emergency_contact_phone=data.emergency_contact_phone,
        emergency_contact_relation=data.emergency_contact_relation,
        bank_card_number=data.bank_card_number,
        bank_name=data.bank_name,
        notes=data.notes,
        work_type=data.work_type,
        shift_template_id=data.shift_template_id,
        salary_type=data.salary_type,
        base_salary=data.base_salary,
        hourly_rate=data.hourly_rate,
        daily_rate=data.daily_rate,
        overtime_multiplier=data.overtime_multiplier,
        is_active=True,
    )
    db.add(employee)
    await db.flush()
    return employee


__all__ = ["create_employee"]
