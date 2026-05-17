"""Role-based access control.

Permissions are dot-namespaced: <resource>.<action>[.<scope>].
Scopes:
- (none)  → company-wide (filtered by tenant listener)
- branch  → only the user's own branch
- self    → only the user's own resource

Wildcards:
- "*"           → all permissions
- "company.*"   → all actions on company
"""
from __future__ import annotations

from enum import StrEnum


class Role(StrEnum):
    OWNER = "OWNER"
    COMPANY_ADMIN = "COMPANY_ADMIN"
    HR_MANAGER = "HR_MANAGER"
    BRANCH_MANAGER = "BRANCH_MANAGER"
    EMPLOYEE = "EMPLOYEE"
    DEVICE = "DEVICE"
    KIOSK = "KIOSK"


# Phase 1 covers: company, branch, department, employee.read/create.
# More resources (shift, attendance, salary, kpi, leave) get added as phases land.
ROLE_PERMISSIONS: dict[Role, list[str]] = {
    Role.OWNER: ["*"],
    Role.COMPANY_ADMIN: [
        "company.read",
        "company.update",
        "branch.*",
        "department.*",
        "employee.*",
        "shift.*",
        "attendance.*",
        "salary.*",
        "bonus.*",
        "deduction.*",
        "leave.*",
        "kpi.*",
        "device.*",
        "kiosk.*",
        "user.*",
        "audit.read",
        "report.*",
        "telegram.*",
    ],
    Role.HR_MANAGER: [
        "company.read",
        "branch.read",
        "department.read",
        "employee.*",
        "shift.read",
        "shift.create",
        "shift.update",
        "attendance.read",
        "attendance.create",
        "attendance.update",
        "salary.read",
        "salary.update",
        "salary.approve",
        "bonus.create",
        "bonus.read",
        "deduction.create",
        "deduction.read",
        "leave.*",
        "kpi.read",
        "kpi.create",
        "kpi.update",
        "kpi.approve",
        "device.read",
        "report.read",
        "report.create",
    ],
    Role.BRANCH_MANAGER: [
        "company.read",
        "branch.read",
        "department.read.branch",
        "employee.read.branch",
        "employee.update.branch",
        "shift.read.branch",
        "shift.update.branch",
        "attendance.read.branch",
        "attendance.create.branch",
        "attendance.update.branch",
        "kpi.read.branch",
        "kpi.approve.branch",
        "leave.read.branch",
        "leave.update.branch",
        "bonus.create.branch",
        "bonus.read.branch",
        "deduction.create.branch",
        "deduction.read.branch",
        "salary.read.branch",
        "notification.read",
        "report.read.branch",
        "report.create.branch",
    ],
    Role.EMPLOYEE: [
        "self.read",
        "self.update",
        "self.attendance.create",
    ],
    Role.DEVICE: [
        "device.event",
    ],
    Role.KIOSK: [
        # Tablet kiosks identify employees via face recognition and
        # write attendance directly. They never need to read other
        # company data.
        "kiosk.checkin",
        "kiosk.checkout",
        "kiosk.heartbeat",
    ],
}

# Permissions used by admin-side CRUD on kiosks themselves. Granted
# automatically by the wildcard rules above for OWNER / COMPANY_ADMIN.
_KIOSK_ADMIN_PERMS = (
    "kiosk.read",
    "kiosk.create",
    "kiosk.update",
    "kiosk.delete",
)
ROLE_PERMISSIONS[Role.HR_MANAGER].extend(_KIOSK_ADMIN_PERMS)
ROLE_PERMISSIONS[Role.BRANCH_MANAGER].extend(
    [f"{p}.branch" for p in _KIOSK_ADMIN_PERMS]
)


_SCOPE_SUFFIXES = (".branch", ".self")


def _matches(granted: str, required: str) -> bool:
    if granted == "*":
        return True
    if granted == required:
        return True
    if granted.endswith(".*"):
        prefix = granted[:-2]
        return required == prefix or required.startswith(prefix + ".")
    # Scope-suffixed grants (``X.Y.branch`` / ``X.Y.self``) satisfy the
    # broader ``X.Y`` permission *check*. The endpoint is then responsible
    # for actually enforcing the scope (``apply_branch_scope`` in deps, or a
    # ``branch_id``/``user_id`` filter in the query). Without this, every
    # endpoint would have to accept both forms in its require_permission()
    # call — error-prone, especially for security.
    for suffix in _SCOPE_SUFFIXES:
        if granted.endswith(suffix):
            base = granted[: -len(suffix)]
            if base == required:
                return True
    return False


def has_permission(role: Role | str, required: str) -> bool:
    role_enum = Role(role) if isinstance(role, str) else role
    granted_list = ROLE_PERMISSIONS.get(role_enum, [])
    return any(_matches(g, required) for g in granted_list)


__all__ = ["ROLE_PERMISSIONS", "Role", "has_permission"]
