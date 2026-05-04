"""Test fixtures.

Strategy: schema is created exactly once per pytest session via a synchronous
psycopg-free path (raw asyncpg in a one-shot loop). Each test then gets its
own function-scoped async engine + session, which dodges the SQLAlchemy
"connection attached to a different loop" headache that comes from sharing a
session-scoped engine across function-scoped event loops.

Override ``TEST_DATABASE_URL`` to point at a custom Postgres if needed.
"""
from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncGenerator
from typing import Any

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import NullPool
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings
from app.core.permissions import Role
from app.core.security import hash_password
from app.core.tenant import install_tenant_listener, set_current_tenant
from app.database import get_db
from app.main import create_app
from app.models.base import Base
from app.models.company import Company
from app.models.user import User, UserStatus


def _test_db_url() -> str:
    explicit = os.environ.get("TEST_DATABASE_URL")
    if explicit:
        return explicit
    base = settings.database_url_async
    head, _, _ = base.rpartition("/")
    return f"{head}/{settings.postgres_db}_test"


@pytest.fixture(scope="session", autouse=True)
def _bootstrap_schema():
    """Drop + recreate every table once per session. Uses a throwaway loop so
    we don't interfere with pytest-asyncio's per-test loops."""

    async def _do() -> None:
        eng = create_async_engine(_test_db_url(), poolclass=NullPool)
        try:
            async with eng.begin() as conn:
                await conn.run_sync(Base.metadata.drop_all)
                await conn.run_sync(Base.metadata.create_all)
        finally:
            await eng.dispose()

    asyncio.run(_do())
    install_tenant_listener()
    yield


@pytest_asyncio.fixture
async def engine():
    """Per-test async engine. NullPool avoids any connection re-use across
    tests/loops; the cost is one TCP connect per test, which is fine."""
    eng = create_async_engine(_test_db_url(), poolclass=NullPool)
    yield eng
    await eng.dispose()


@pytest_asyncio.fixture
async def db_session(engine) -> AsyncGenerator[AsyncSession, None]:
    factory = async_sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)
    async with factory() as session:
        yield session
        await session.rollback()
    async with engine.begin() as conn:
        await conn.exec_driver_sql(
            "TRUNCATE refresh_tokens, audit_logs, departments, branches, users, companies "
            "RESTART IDENTITY CASCADE"
        )
    set_current_tenant(None)


@pytest_asyncio.fixture
async def client(db_session) -> AsyncGenerator[AsyncClient, None]:
    app = create_app()

    async def _override_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


# ---------- Convenience factories ------------------------------------------------


@pytest_asyncio.fixture
async def make_company(db_session):
    counter = {"i": 0}

    async def _factory(slug: str | None = None, **overrides: Any) -> Company:
        counter["i"] += 1
        company = Company(
            name=overrides.pop("name", f"Test Co {counter['i']}"),
            slug=slug or f"test-co-{counter['i']}",
            **overrides,
        )
        db_session.add(company)
        await db_session.commit()
        await db_session.refresh(company)
        return company

    return _factory


@pytest_asyncio.fixture
async def make_user(db_session):
    counter = {"i": 0}

    async def _factory(
        company: Company | None = None,
        role: Role = Role.COMPANY_ADMIN,
        password: str = "TestPass123!",
        **overrides: Any,
    ) -> User:
        counter["i"] += 1
        user = User(
            company_id=company.id if company else None,
            username=overrides.pop("username", f"user{counter['i']}"),
            email=overrides.pop("email", f"user{counter['i']}@test.local"),
            password_hash=hash_password(password),
            role=role,
            status=UserStatus.ACTIVE,
            full_name=overrides.pop("full_name", f"User {counter['i']}"),
            language=overrides.pop("language", "uz"),
            is_active=True,
            **overrides,
        )
        db_session.add(user)
        await db_session.commit()
        await db_session.refresh(user)
        return user

    return _factory


@pytest_asyncio.fixture
async def login(client):
    async def _do(username: str, password: str = "TestPass123!") -> AsyncClient:
        resp = await client.post(
            f"{settings.api_v1_prefix}/auth/login",
            json={"username": username, "password": password},
        )
        assert resp.status_code == 200, resp.text
        token = resp.json()["access_token"]
        client.headers["Authorization"] = f"Bearer {token}"
        return client

    return _do
