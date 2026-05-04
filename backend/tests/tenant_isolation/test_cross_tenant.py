"""The ONE test suite that must never go red.

Every endpoint that returns or mutates tenant data is tested twice — once where
the listener should let the request through, and once where it must block a
cross-tenant query.

If you add a new tenant-scoped resource, add a test here. No exceptions.
"""
from __future__ import annotations

import pytest

from app.config import settings
from app.core.permissions import Role


@pytest.mark.asyncio
async def test_branches_are_scoped_to_caller_company(client, make_company, make_user):
    """Two companies, each with one branch. A logs in, lists branches, must
    only see its own."""
    company_a = await make_company(slug="a-co")
    company_b = await make_company(slug="b-co")

    admin_a = await make_user(company=company_a, role=Role.COMPANY_ADMIN, username="admin_a")
    await make_user(company=company_b, role=Role.COMPANY_ADMIN, username="admin_b")

    # Log in as admin_a and create a branch.
    resp = await client.post(
        f"{settings.api_v1_prefix}/auth/login",
        json={"username": "admin_a", "password": "TestPass123!"},
    )
    token_a = resp.json()["access_token"]
    headers_a = {"Authorization": f"Bearer {token_a}"}

    resp = await client.post(
        f"{settings.api_v1_prefix}/branches",
        headers=headers_a,
        json={"name": "Main A", "geofence_radius_m": 200},
    )
    assert resp.status_code == 201, resp.text
    branch_a_id = resp.json()["id"]

    # Log in as admin_b and create a branch.
    resp = await client.post(
        f"{settings.api_v1_prefix}/auth/login",
        json={"username": "admin_b", "password": "TestPass123!"},
    )
    token_b = resp.json()["access_token"]
    headers_b = {"Authorization": f"Bearer {token_b}"}

    resp = await client.post(
        f"{settings.api_v1_prefix}/branches",
        headers=headers_b,
        json={"name": "Main B", "geofence_radius_m": 200},
    )
    assert resp.status_code == 201
    branch_b_id = resp.json()["id"]
    assert branch_a_id != branch_b_id

    # admin_b lists branches → should only see B.
    resp = await client.get(f"{settings.api_v1_prefix}/branches", headers=headers_b)
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) == 1
    assert items[0]["id"] == branch_b_id

    # admin_b tries to GET A's branch by ID → 404 (the tenant filter hides it).
    resp = await client.get(
        f"{settings.api_v1_prefix}/branches/{branch_a_id}", headers=headers_b
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_company_admin_cannot_pass_other_company_id(
    client, make_company, make_user
):
    company_a = await make_company(slug="a")
    company_b = await make_company(slug="b")
    await make_user(company=company_a, role=Role.COMPANY_ADMIN, username="a_admin")

    resp = await client.post(
        f"{settings.api_v1_prefix}/auth/login",
        json={"username": "a_admin", "password": "TestPass123!"},
    )
    token = resp.json()["access_token"]

    # Trying to spoof the tenant via ?company_id=B must be a hard 403.
    resp = await client.get(
        f"{settings.api_v1_prefix}/branches?company_id={company_b.id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403
    assert resp.json()["code"] == "tenant.cross_tenant_forbidden"


@pytest.mark.asyncio
async def test_owner_can_query_specific_company(client, make_company, make_user):
    company_a = await make_company(slug="a")
    company_b = await make_company(slug="b")
    owner = await make_user(company=None, role=Role.OWNER, username="root")
    admin_a = await make_user(company=company_a, role=Role.COMPANY_ADMIN, username="aa")
    # Create a branch as A's admin so we have data to read.
    resp = await client.post(
        f"{settings.api_v1_prefix}/auth/login",
        json={"username": "aa", "password": "TestPass123!"},
    )
    token_a = resp.json()["access_token"]
    await client.post(
        f"{settings.api_v1_prefix}/branches",
        headers={"Authorization": f"Bearer {token_a}"},
        json={"name": "A's Office"},
    )

    # Owner logs in.
    resp = await client.post(
        f"{settings.api_v1_prefix}/auth/login",
        json={"username": "root", "password": "TestPass123!"},
    )
    token_owner = resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token_owner}"}

    # ?company_id=A → sees A's branch.
    resp = await client.get(
        f"{settings.api_v1_prefix}/branches?company_id={company_a.id}", headers=headers
    )
    assert resp.status_code == 200
    assert resp.json()["total"] == 1

    # ?company_id=B → sees nothing.
    resp = await client.get(
        f"{settings.api_v1_prefix}/branches?company_id={company_b.id}", headers=headers
    )
    assert resp.status_code == 200
    assert resp.json()["total"] == 0


@pytest.mark.asyncio
async def test_employees_are_scoped_to_caller_company(client, make_company, make_user):
    """Phase 2 entity, same rule as branches."""
    company_a = await make_company(slug="emp-a")
    company_b = await make_company(slug="emp-b")
    await make_user(company=company_a, role=Role.COMPANY_ADMIN, username="emp_admin_a")
    await make_user(company=company_b, role=Role.COMPANY_ADMIN, username="emp_admin_b")

    # admin_a creates an employee.
    resp = await client.post(
        f"{settings.api_v1_prefix}/auth/login",
        json={"username": "emp_admin_a", "password": "TestPass123!"},
    )
    headers_a = {"Authorization": f"Bearer {resp.json()['access_token']}"}
    resp = await client.post(
        f"{settings.api_v1_prefix}/employees",
        headers=headers_a,
        json={"employee_code": "A-1", "full_name": "Aliyev"},
    )
    assert resp.status_code == 201, resp.text
    a_emp_id = resp.json()["id"]

    # admin_b sees their own list — must be empty.
    resp = await client.post(
        f"{settings.api_v1_prefix}/auth/login",
        json={"username": "emp_admin_b", "password": "TestPass123!"},
    )
    headers_b = {"Authorization": f"Bearer {resp.json()['access_token']}"}
    resp = await client.get(f"{settings.api_v1_prefix}/employees", headers=headers_b)
    assert resp.status_code == 200
    assert resp.json()["total"] == 0

    # admin_b can't fetch A's employee by ID.
    resp = await client.get(
        f"{settings.api_v1_prefix}/employees/{a_emp_id}", headers=headers_b
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_attendance_records_are_scoped_to_caller_company(
    client, make_company, make_user
):
    """Manual attendance + cross-tenant read."""
    from datetime import datetime, timezone

    company_a = await make_company(slug="att-a")
    company_b = await make_company(slug="att-b")
    await make_user(company=company_a, role=Role.COMPANY_ADMIN, username="att_admin_a")
    await make_user(company=company_b, role=Role.COMPANY_ADMIN, username="att_admin_b")

    # admin_a logs in, creates an employee and a manual attendance row.
    resp = await client.post(
        f"{settings.api_v1_prefix}/auth/login",
        json={"username": "att_admin_a", "password": "TestPass123!"},
    )
    headers_a = {"Authorization": f"Bearer {resp.json()['access_token']}"}
    resp = await client.post(
        f"{settings.api_v1_prefix}/employees",
        headers=headers_a,
        json={"employee_code": "X-1", "full_name": "Tester"},
    )
    assert resp.status_code == 201, resp.text
    emp_id = resp.json()["id"]

    resp = await client.post(
        f"{settings.api_v1_prefix}/attendance/manual",
        headers=headers_a,
        json={
            "employee_id": emp_id,
            "check_type": "CHECK_IN",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    )
    assert resp.status_code == 201, resp.text

    # admin_b must see zero records.
    resp = await client.post(
        f"{settings.api_v1_prefix}/auth/login",
        json={"username": "att_admin_b", "password": "TestPass123!"},
    )
    headers_b = {"Authorization": f"Bearer {resp.json()['access_token']}"}
    resp = await client.get(
        f"{settings.api_v1_prefix}/attendance/records", headers=headers_b
    )
    assert resp.status_code == 200
    assert resp.json()["total"] == 0


@pytest.mark.asyncio
async def test_bonuses_and_leaves_are_scoped_to_caller_company(
    client, make_company, make_user
):
    """Phase 3 entities — bonus + leave — must respect the same tenant filter."""
    from datetime import date as Date

    company_a = await make_company(slug="ph3-a")
    company_b = await make_company(slug="ph3-b")
    await make_user(company=company_a, role=Role.COMPANY_ADMIN, username="ph3_admin_a")
    await make_user(company=company_b, role=Role.COMPANY_ADMIN, username="ph3_admin_b")

    # admin_a logs in, creates an employee + a bonus + a leave type.
    resp = await client.post(
        f"{settings.api_v1_prefix}/auth/login",
        json={"username": "ph3_admin_a", "password": "TestPass123!"},
    )
    headers_a = {"Authorization": f"Bearer {resp.json()['access_token']}"}
    resp = await client.post(
        f"{settings.api_v1_prefix}/employees",
        headers=headers_a,
        json={"employee_code": "P3-1", "full_name": "P3 Tester"},
    )
    assert resp.status_code == 201
    emp_id = resp.json()["id"]

    today = Date.today().isoformat()
    resp = await client.post(
        f"{settings.api_v1_prefix}/bonuses",
        headers=headers_a,
        json={
            "employee_id": emp_id,
            "type": "FIXED",
            "amount": 100,
            "applied_date": today,
        },
    )
    assert resp.status_code == 201, resp.text

    resp = await client.post(
        f"{settings.api_v1_prefix}/leave-types",
        headers=headers_a,
        json={"name": "Annual", "paid": True},
    )
    assert resp.status_code == 201

    # admin_b sees nothing for either resource.
    resp = await client.post(
        f"{settings.api_v1_prefix}/auth/login",
        json={"username": "ph3_admin_b", "password": "TestPass123!"},
    )
    headers_b = {"Authorization": f"Bearer {resp.json()['access_token']}"}

    resp = await client.get(f"{settings.api_v1_prefix}/bonuses", headers=headers_b)
    assert resp.status_code == 200
    assert len(resp.json()) == 0

    resp = await client.get(f"{settings.api_v1_prefix}/leave-types", headers=headers_b)
    assert resp.status_code == 200
    assert len(resp.json()) == 0


@pytest.mark.asyncio
async def test_devices_are_scoped_to_caller_company(client, make_company, make_user):
    """Phase 4: Device must respect the same tenant filter as everything else.

    Without this check a Hikvision device webhook could leak attendance
    cross-tenant if the device row were ever queried unscoped."""
    company_a = await make_company(slug="dev-a")
    company_b = await make_company(slug="dev-b")
    await make_user(company=company_a, role=Role.COMPANY_ADMIN, username="dev_admin_a")
    await make_user(company=company_b, role=Role.COMPANY_ADMIN, username="dev_admin_b")

    resp = await client.post(
        f"{settings.api_v1_prefix}/auth/login",
        json={"username": "dev_admin_a", "password": "TestPass123!"},
    )
    headers_a = {"Authorization": f"Bearer {resp.json()['access_token']}"}
    resp = await client.post(
        f"{settings.api_v1_prefix}/devices",
        headers=headers_a,
        json={
            "name": "A's Door",
            "vendor": "HIKVISION",
            "model": "DS-K1T343",
            "serial_number": "TENANT-A-1",
            "location_role": "BOTH",
        },
    )
    assert resp.status_code == 201, resp.text
    a_device_id = resp.json()["device"]["id"]

    resp = await client.post(
        f"{settings.api_v1_prefix}/auth/login",
        json={"username": "dev_admin_b", "password": "TestPass123!"},
    )
    headers_b = {"Authorization": f"Bearer {resp.json()['access_token']}"}

    resp = await client.get(f"{settings.api_v1_prefix}/devices", headers=headers_b)
    assert resp.status_code == 200
    assert resp.json()["total"] == 0

    resp = await client.get(
        f"{settings.api_v1_prefix}/devices/{a_device_id}", headers=headers_b
    )
    assert resp.status_code == 404
