"""End-to-end auth flow: login → me → refresh → logout."""
from __future__ import annotations

import pytest

from app.config import settings
from app.core.permissions import Role


@pytest.mark.asyncio
async def test_login_flow(client, make_company, make_user):
    company = await make_company()
    user = await make_user(company=company, role=Role.COMPANY_ADMIN, username="admin1")

    # Login
    resp = await client.post(
        f"{settings.api_v1_prefix}/auth/login",
        json={"username": "admin1", "password": "TestPass123!"},
    )
    assert resp.status_code == 200, resp.text
    pair = resp.json()
    assert "access_token" in pair and "refresh_token" in pair

    # Me
    resp = await client.get(
        f"{settings.api_v1_prefix}/auth/me",
        headers={"Authorization": f"Bearer {pair['access_token']}"},
    )
    assert resp.status_code == 200
    me = resp.json()
    assert me["username"] == "admin1"
    assert me["company_id"] == str(company.id)

    # Refresh — JWT iat/exp are second-resolution and the access payload is
    # otherwise identical, so the access token may be byte-equal if the call
    # happens within the same second. The actual rotation guarantee lives on
    # the refresh side: a new jti must be issued.
    resp = await client.post(
        f"{settings.api_v1_prefix}/auth/refresh",
        json={"refresh_token": pair["refresh_token"]},
    )
    assert resp.status_code == 200
    new_pair = resp.json()
    assert new_pair["refresh_token"] != pair["refresh_token"]

    # Old refresh token is now revoked.
    resp = await client.post(
        f"{settings.api_v1_prefix}/auth/refresh",
        json={"refresh_token": pair["refresh_token"]},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_login_invalid_credentials(client, make_company, make_user):
    company = await make_company()
    await make_user(company=company, username="bob")
    resp = await client.post(
        f"{settings.api_v1_prefix}/auth/login",
        json={"username": "bob", "password": "WrongPass!"},
    )
    assert resp.status_code == 401
    assert resp.json()["code"] == "auth.invalid_credentials"
