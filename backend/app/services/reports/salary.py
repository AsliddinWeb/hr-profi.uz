"""Salary register report — payroll-style monthly export."""
from __future__ import annotations

from typing import AsyncIterator
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.branch import Branch
from app.models.department import Department
from app.models.employee import Employee
from app.models.salary import SalaryPeriod


def _name_map(rows) -> dict[UUID, str]:
    return {r[0]: r[1] for r in rows}


async def salary_register(
    db: AsyncSession,
    company_id: UUID,
    params: dict,
    branch_filter: UUID | None,
) -> AsyncIterator[list[str]]:
    """One row per employee for the requested year/month.

    Sums everything that landed in ``salary_periods`` (already aggregated
    from the daily accruals by the salary engine), so we don't re-walk
    the daily table here. Pending = total_earned − paid_amount. Status
    column shows the period's lifecycle (DRAFT → APPROVED → PAID).
    """
    year = int(params.get("year") or 0)
    month = int(params.get("month") or 0)
    if not (1 <= month <= 12 and 2000 <= year <= 2100):
        raise ValueError("salary_register.bad_year_month")

    branch_id = branch_filter or (
        UUID(params["branch_id"]) if params.get("branch_id") else None
    )
    department_id = (
        UUID(params["department_id"]) if params.get("department_id") else None
    )

    emp_stmt = (
        select(Employee)
        .where(Employee.company_id == company_id)
        .order_by(Employee.full_name)
    )
    if branch_id is not None:
        emp_stmt = emp_stmt.where(Employee.branch_id == branch_id)
    if department_id is not None:
        emp_stmt = emp_stmt.where(Employee.department_id == department_id)
    emp_stmt = emp_stmt.execution_options(skip_tenant_filter=True)
    employees = (await db.execute(emp_stmt)).scalars().all()

    branch_names = _name_map(
        (
            await db.execute(
                select(Branch.id, Branch.name)
                .where(Branch.company_id == company_id)
                .execution_options(skip_tenant_filter=True)
            )
        ).all()
    )
    dept_names = _name_map(
        (
            await db.execute(
                select(Department.id, Department.name)
                .where(Department.company_id == company_id)
                .execution_options(skip_tenant_filter=True)
            )
        ).all()
    )

    yield [
        "Employee code",
        "Full name",
        "Branch",
        "Department",
        "Year-Month",
        "Base",
        "Overtime",
        "Bonuses",
        "KPI",
        "Deductions",
        "Total earned",
        "Paid",
        "Pending",
        "Status",
    ]

    if not employees:
        return

    emp_ids = [e.id for e in employees]
    periods = (
        await db.execute(
            select(SalaryPeriod)
            .where(
                SalaryPeriod.employee_id.in_(emp_ids),
                SalaryPeriod.year == year,
                SalaryPeriod.month == month,
            )
            .execution_options(skip_tenant_filter=True)
        )
    ).scalars().all()
    by_emp = {p.employee_id: p for p in periods}
    ym = f"{year}-{month:02d}"

    for e in employees:
        p = by_emp.get(e.id)
        if p is None:
            yield [
                e.employee_code,
                e.full_name or "",
                branch_names.get(e.branch_id, "") if e.branch_id else "",
                dept_names.get(e.department_id, "") if e.department_id else "",
                ym,
                "0", "0", "0", "0", "0", "0", "0", "0",
                "—",
            ]
            continue
        total = float(p.total_earned or 0)
        paid = float(p.paid_amount or 0)
        yield [
            e.employee_code,
            e.full_name or "",
            branch_names.get(e.branch_id, "") if e.branch_id else "",
            dept_names.get(e.department_id, "") if e.department_id else "",
            ym,
            str(int(round(float(p.base_amount or 0)))),
            str(int(round(float(p.overtime_amount or 0)))),
            str(int(round(float(p.bonuses_total or 0)))),
            str(int(round(float(p.kpi_amount or 0)))),
            str(int(round(float(p.deductions_total or 0)))),
            str(int(round(total))),
            str(int(round(paid))),
            str(int(round(total - paid))),
            str(p.status.value if hasattr(p.status, "value") else p.status),
        ]
