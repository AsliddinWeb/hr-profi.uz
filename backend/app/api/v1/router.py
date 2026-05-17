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
    telegram,
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
# Kiosk runtime endpoints (``/kiosks/me/*``) MUST be registered before
# the admin CRUD router. Both share the ``/kiosks`` prefix, and the
# admin's ``GET /kiosks/{kiosk_id}`` would otherwise capture
# ``GET /kiosks/me`` (matching ``kiosk_id="me"``) and immediately fail
# the User-typed dep with a 401, even though the kiosk JWT is valid.
api_router.include_router(kiosk_runtime.router)
api_router.include_router(kiosks.router)
api_router.include_router(notifications.router)
api_router.include_router(dashboard.router)
api_router.include_router(plans.router)
api_router.include_router(uploads.router)
api_router.include_router(audit.router)
api_router.include_router(reports.router)
api_router.include_router(telegram.router)


__all__ = ["api_router"]
