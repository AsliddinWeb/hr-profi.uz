"""Persisted in-app notifications + WS push."""
from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import (
    Notification,
    NotificationCategory,
    NotificationPreference,
)
from app.services.ws_publisher import publish_event

logger = logging.getLogger(__name__)


async def _is_muted(
    db: AsyncSession, user_id: UUID, category: NotificationCategory
) -> bool:
    """Check user's per-category preference. Missing row = enabled."""
    pref = (
        await db.execute(
            select(NotificationPreference)
            .where(
                NotificationPreference.user_id == user_id,
                NotificationPreference.category == category.value,
            )
        )
    ).scalar_one_or_none()
    return pref is not None and pref.enabled is False


async def notify(
    db: AsyncSession,
    *,
    user_id: UUID,
    title: str,
    body: str | None = None,
    category: NotificationCategory = NotificationCategory.SYSTEM,
    company_id: UUID | None = None,
    payload: dict[str, Any] | None = None,
    commit: bool = True,
) -> Notification | None:
    """Insert a notification row and push a ``notification_new`` WS event.

    Returns ``None`` when the user has muted this category (no row inserted,
    no WS event). System messages bypass the mute — they're rare and usually
    operationally critical.
    """
    if category != NotificationCategory.SYSTEM and await _is_muted(
        db, user_id, category
    ):
        return None
    n = Notification(
        user_id=user_id,
        company_id=company_id,
        category=category,
        title=title,
        body=body,
        payload=payload,
    )
    db.add(n)
    if commit:
        await db.commit()
        await db.refresh(n)

    try:
        await publish_event(
            event="notification_new",
            user_id=user_id,
            company_id=company_id,
            payload={
                "id": str(n.id),
                "category": category.value,
                "title": title,
                "body": body,
            },
        )
    except Exception:  # noqa: BLE001
        logger.exception("notification WS push failed for user=%s", user_id)

    # Web Push: best-effort, never blocks notification creation.
    try:
        from app.services import web_push_service

        await web_push_service.send_to_user(
            db,
            user_id=user_id,
            title=title,
            body=body,
            payload={
                "id": str(n.id),
                "category": category.value,
                **(payload or {}),
            },
        )
    except Exception:  # noqa: BLE001
        logger.exception("web push failed for user=%s", user_id)
    return n


async def notify_company_admins(
    db: AsyncSession,
    *,
    company_id: UUID,
    title: str,
    body: str | None = None,
    category: NotificationCategory = NotificationCategory.ANOMALY,
    payload: dict[str, Any] | None = None,
) -> int:
    """Broadcast to every COMPANY_ADMIN/HR_MANAGER user of a company.

    Used for anomaly + device-offline alerts. We push to the company WS
    channel as well so currently-connected admins see it instantly."""
    from sqlalchemy import select

    from app.core.permissions import Role
    from app.models.user import User

    rows = (
        await db.execute(
            select(User.id).where(
                User.company_id == company_id,
                User.role.in_((Role.COMPANY_ADMIN.value, Role.HR_MANAGER.value)),
                User.is_active.is_(True),
            )
            .execution_options(skip_tenant_filter=True)
        )
    ).scalars().all()

    for uid in rows:
        await notify(
            db,
            user_id=uid,
            title=title,
            body=body,
            category=category,
            company_id=company_id,
            payload=payload,
            commit=False,
        )
    await db.commit()

    # One company-channel WS event for all online admin sockets.
    try:
        await publish_event(
            event="anomaly_detected" if category == NotificationCategory.ANOMALY else "notification_new",
            company_id=company_id,
            payload={"title": title, "body": body, **(payload or {})},
        )
    except Exception:  # noqa: BLE001
        logger.exception("admin broadcast failed for company=%s", company_id)
    return len(rows)


async def notify_branch_managers(
    db: AsyncSession,
    *,
    company_id: UUID,
    branch_id: UUID,
    title: str,
    body: str | None = None,
    category: NotificationCategory = NotificationCategory.ANOMALY,
    payload: dict[str, Any] | None = None,
) -> int:
    """Notify every BRANCH_MANAGER assigned to ``branch_id``.

    Used when a branch-local event happens (a new leave request from one of
    the branch's employees, an out-of-geofence check-in inside the branch,
    etc.). Company-wide admins are *not* CC'd here — pair this with
    ``notify_company_admins`` if you want both audiences. Returning the
    count lets callers detect "no manager assigned to this branch" and
    decide whether to escalate to company admins as a fallback.
    """
    from sqlalchemy import select

    from app.core.permissions import Role
    from app.models.user import User

    rows = (
        await db.execute(
            select(User.id).where(
                User.company_id == company_id,
                User.branch_id == branch_id,
                User.role == Role.BRANCH_MANAGER.value,
                User.is_active.is_(True),
            )
            .execution_options(skip_tenant_filter=True)
        )
    ).scalars().all()

    for uid in rows:
        await notify(
            db,
            user_id=uid,
            title=title,
            body=body,
            category=category,
            company_id=company_id,
            payload=payload,
            commit=False,
        )
    if rows:
        await db.commit()
    return len(rows)


__all__ = ["notify", "notify_branch_managers", "notify_company_admins"]
