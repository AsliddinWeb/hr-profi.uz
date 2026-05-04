"""Idempotent seed script — creates the initial OWNER user from env if missing.

Run via Makefile: ``make seed`` (which execs in the api container).
"""
from __future__ import annotations

import asyncio
import sys

from sqlalchemy import select

from app.config import settings
from app.core.permissions import Role
from app.core.security import hash_password
from app.database import AsyncSessionLocal
from app.models.user import User, UserStatus


async def main() -> int:
    async with AsyncSessionLocal() as db:
        existing = await db.execute(
            select(User)
            .where(User.username == settings.initial_owner_username, User.role == Role.OWNER.value)
            .execution_options(skip_tenant_filter=True)
        )
        if existing.scalar_one_or_none():
            print(f"[seed] OWNER user '{settings.initial_owner_username}' already exists.")
            return 0

        owner = User(
            company_id=None,
            username=settings.initial_owner_username,
            email=settings.initial_owner_email,
            password_hash=hash_password(settings.initial_owner_password),
            role=Role.OWNER,
            status=UserStatus.ACTIVE,
            full_name="System Owner",
            language=settings.default_language,
            is_active=True,
        )
        db.add(owner)
        await db.commit()
        print(
            f"[seed] OWNER created: username={settings.initial_owner_username} "
            f"email={settings.initial_owner_email}"
        )
        return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
