"""Permission matcher unit tests."""
from __future__ import annotations

import pytest

from app.core.permissions import Role, has_permission


@pytest.mark.parametrize(
    "role,permission,expected",
    [
        (Role.OWNER, "anything.at_all", True),
        (Role.OWNER, "company.read", True),
        (Role.COMPANY_ADMIN, "company.read", True),
        (Role.COMPANY_ADMIN, "branch.create", True),
        (Role.COMPANY_ADMIN, "branch.delete", True),
        (Role.HR_MANAGER, "employee.create", True),
        (Role.HR_MANAGER, "company.update", False),
        (Role.BRANCH_MANAGER, "employee.read.branch", True),
        (Role.BRANCH_MANAGER, "branch.create", False),
        (Role.EMPLOYEE, "self.read", True),
        (Role.EMPLOYEE, "employee.read", False),
        (Role.DEVICE, "device.event", True),
        (Role.DEVICE, "employee.read", False),
    ],
)
def test_has_permission(role: Role, permission: str, expected: bool) -> None:
    assert has_permission(role, permission) is expected
