"""Aggregates every v1 router into a single APIRouter."""
from __future__ import annotations

from fastapi import APIRouter

from app.api.v1 import (
    attendance,
    audit,
    auth,
    bonuses,
    branches,
    companies,
    dashboard,
    departments,
    devices,
    employees,
    kiosk_runtime,
    kiosks,
    kpi,
    leaves,
    notifications,
    owner,
    plans,
    reports,
    salary,
    shifts,
    uploads,
    users,
)

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(owner.router)
api_router.include_router(companies.router)
api_router.include_router(branches.router)
api_router.include_router(departments.router)
api_router.include_router(users.router)
api_router.include_router(employees.router)
api_router.include_router(shifts.router)
api_router.include_router(attendance.router)
api_router.include_router(salary.router)
api_router.include_router(bonuses.router)
api_router.include_router(leaves.router)
api_router.include_router(kpi.router)
api_router.include_router(devices.router)
api_router.include_router(kiosks.router)
api_router.include_router(kiosk_runtime.router)
api_router.include_router(notifications.router)
api_router.include_router(dashboard.router)
api_router.include_router(plans.router)
api_router.include_router(uploads.router)
api_router.include_router(audit.router)
api_router.include_router(reports.router)


__all__ = ["api_router"]
