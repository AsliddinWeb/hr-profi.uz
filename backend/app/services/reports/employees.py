"""Employee roster report."""
from __future__ import annotations

from typing import AsyncIterator
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.branch import Branch
from app.models.department import Department
from app.models.employee import Employee


async def employee_roster(
    db: AsyncSession,
    company_id: UUID,
    params: dict,
    branch_filter: UUID | None,
) -> AsyncIterator[list[str]]:
    """Snapshot of the workforce. Optionally include or exclude inactive
    rows via ``params['include_inactive']`` (defaults to active-only)."""
    include_inactive = bool(params.get("include_inactive"))

    branch_id = branch_filter or (
        UUID(params["branch_id"]) if params.get("branch_id") else None
    )
    department_id = (
        UUID(params["department_id"]) if params.get("department_id") else None
    )

    stmt = (
        select(Employee)
        .where(Employee.company_id == company_id)
        .order_by(Employee.full_name)
    )
    if not include_inactive:
        stmt = stmt.where(Employee.is_active.is_(True))
    if branch_id is not None:
        stmt = stmt.where(Employee.branch_id == branch_id)
    if department_id is not None:
        stmt = stmt.where(Employee.department_id == department_id)
    stmt = stmt.execution_options(skip_tenant_filter=True)
    employees = (await db.execute(stmt)).scalars().all()

    branch_names = {
        r[0]: r[1]
        for r in (
            await db.execute(
                select(Branch.id, Branch.name)
                .where(Branch.company_id == company_id)
                .execution_options(skip_tenant_filter=True)
            )
        ).all()
    }
    dept_names = {
        r[0]: r[1]
        for r in (
            await db.execute(
                select(Department.id, Department.name)
                .where(Department.company_id == company_id)
                .execution_options(skip_tenant_filter=True)
            )
        ).all()
    }

    yield [
        "Code",
        "Full name",
        "Position",
        "Branch",
        "Department",
        "Phone",
        "Email",
        "Hire date",
        "Salary type",
        "Base salary",
        "Daily rate",
        "Hourly rate",
        "Status",
    ]

    for e in employees:
        st = (
            "active"
            if e.is_active
            else (
                "terminated"
                if e.terminated_at is not None
                else "inactive"
            )
        )
        yield [
            e.employee_code,
            e.full_name or "",
            e.position or "",
            branch_names.get(e.branch_id, "") if e.branch_id else "",
            dept_names.get(e.department_id, "") if e.department_id else "",
            e.phone or "",
            e.email or "",
            e.hire_date.isoformat() if e.hire_date else "",
            str(e.salary_type.value if hasattr(e.salary_type, "value") else e.salary_type),
            str(int(round(float(e.base_salary or 0)))),
            str(int(round(float(e.daily_rate or 0)))),
            str(int(round(float(e.hourly_rate or 0)))),
            st,
        ]
