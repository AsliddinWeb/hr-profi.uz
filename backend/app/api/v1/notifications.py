"""Per-user notification feed."""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Query, Request, status
from sqlalchemy import delete, desc, func, select, update

from app.config import settings
from app.core.deps import CurrentUser, DbDep
from app.core.exceptions import NotFoundError
from app.models.notification import (
    Notification,
    NotificationCategory,
    NotificationPreference,
)
from app.models.push_subscription import WebPushSubscription
from app.schemas.common import MessageResponse, Page
from app.schemas.notification import (
    NotificationPreferenceItem,
    NotificationPreferences,
    NotificationRead,
)
from app.schemas.push import PushPublicKey, PushSubscriptionIn

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=Page[NotificationRead])
async def list_my_notifications(
    user: CurrentUser,
    db: DbDep,
    unread: bool | None = None,
    category: NotificationCategory | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
) -> Page[NotificationRead]:
    stmt = (
        select(Notification)
        .where(Notification.user_id == user.id)
        .order_by(desc(Notification.created_at))
    )
    count_stmt = select(func.count(Notification.id)).where(Notification.user_id == user.id)

    if unread is not None:
        cond = Notification.is_read.is_(not unread) if unread else Notification.is_read.is_(True)
        # Re-do without negation: caller passes ?unread=true → we want is_read=False.
        cond = Notification.is_read.is_(False) if unread else Notification.is_read.is_(True)
        stmt = stmt.where(cond)
        count_stmt = count_stmt.where(cond)
    if category is not None:
        stmt = stmt.where(Notification.category == category)
        count_stmt = count_stmt.where(Notification.category == category)

    total = (await db.execute(count_stmt)).scalar_one()
    rows = (await db.execute(stmt.offset((page - 1) * size).limit(size))).scalars().all()
    return Page[NotificationRead](
        items=[NotificationRead.model_validate(r) for r in rows],
        total=total,
        page=page,
        size=size,
    )


@router.get("/unread-count")
async def unread_count(user: CurrentUser, db: DbDep) -> dict:
    n = (
        await db.execute(
            select(func.count(Notification.id)).where(
                Notification.user_id == user.id,
                Notification.is_read.is_(False),
            )
        )
    ).scalar_one()
    return {"count": n}


@router.post("/{notification_id}/read", response_model=NotificationRead)
async def mark_read(
    notification_id: UUID, user: CurrentUser, db: DbDep
) -> NotificationRead:
    n = (
        await db.execute(
            select(Notification).where(
                Notification.id == notification_id, Notification.user_id == user.id
            )
        )
    ).scalar_one_or_none()
    if not n:
        raise NotFoundError("notification.not_found")
    if not n.is_read:
        n.is_read = True
        n.read_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(n)
    return NotificationRead.model_validate(n)


@router.post(
    "/read-all",
    response_model=MessageResponse,
    status_code=status.HTTP_200_OK,
)
async def mark_all_read(user: CurrentUser, db: DbDep) -> MessageResponse:
    await db.execute(
        update(Notification)
        .where(Notification.user_id == user.id, Notification.is_read.is_(False))
        .values(is_read=True, read_at=datetime.now(timezone.utc))
    )
    await db.commit()
    return MessageResponse(message="all_read")


@router.delete(
    "/clear-read",
    response_model=MessageResponse,
)
async def clear_read(user: CurrentUser, db: DbDep) -> MessageResponse:
    """Permanently delete every already-read notification for the caller.

    Unread items are kept — the caller must still see them. Lets users keep
    the feed short without losing pending alerts.
    """
    await db.execute(
        delete(Notification).where(
            Notification.user_id == user.id, Notification.is_read.is_(True)
        )
    )
    await db.commit()
    return MessageResponse(message="cleared")


@router.delete(
    "/{notification_id}",
    response_model=MessageResponse,
)
async def delete_notification(
    notification_id: UUID, user: CurrentUser, db: DbDep
) -> MessageResponse:
    n = (
        await db.execute(
            select(Notification).where(
                Notification.id == notification_id,
                Notification.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if not n:
        raise NotFoundError("notification.not_found")
    await db.delete(n)
    await db.commit()
    return MessageResponse(message="deleted")


# ---------- Preferences ----------------------------------------------------


# All categories the user can mute. SYSTEM is intentionally excluded — admin
# alerts must always reach the user.
_MUTABLE_CATEGORIES: list[NotificationCategory] = [
    NotificationCategory.ATTENDANCE,
    NotificationCategory.SALARY,
    NotificationCategory.KPI,
    NotificationCategory.LEAVE,
    NotificationCategory.DEVICE,
    NotificationCategory.ANOMALY,
]


@router.get("/preferences", response_model=NotificationPreferences)
async def get_preferences(
    user: CurrentUser, db: DbDep
) -> NotificationPreferences:
    rows = (
        await db.execute(
            select(NotificationPreference).where(
                NotificationPreference.user_id == user.id
            )
        )
    ).scalars().all()
    by_cat = {p.category: p.enabled for p in rows}
    items = [
        NotificationPreferenceItem(
            category=c, enabled=by_cat.get(c.value, by_cat.get(c, True))
        )
        for c in _MUTABLE_CATEGORIES
    ]
    return NotificationPreferences(items=items)


@router.put("/preferences", response_model=NotificationPreferences)
async def update_preferences(
    data: NotificationPreferences, user: CurrentUser, db: DbDep
) -> NotificationPreferences:
    """Replace all preference rows for the caller. Anything not in ``items``
    stays default-enabled."""
    sent = {item.category.value: item.enabled for item in data.items}
    existing = {
        p.category: p
        for p in (
            await db.execute(
                select(NotificationPreference).where(
                    NotificationPreference.user_id == user.id
                )
            )
        ).scalars().all()
    }
    for cat_value, enabled in sent.items():
        cat_key = cat_value
        if cat_key in existing:
            existing[cat_key].enabled = enabled
        else:
            db.add(
                NotificationPreference(
                    user_id=user.id, category=cat_value, enabled=enabled
                )
            )
    await db.commit()
    return await get_preferences(user, db)


# ---------- Web Push subscriptions ----------------------------------------


@router.get("/push/public-key", response_model=PushPublicKey)
async def push_public_key() -> PushPublicKey:
    """Return the VAPID application server public key.

    The browser uses this to derive the encryption envelope for push
    deliveries. If VAPID is not configured we still return a 200 with an
    empty string so the client can detect "push disabled" without 404
    error noise.
    """
    return PushPublicKey(public_key=settings.vapid_public_key or "")


@router.post(
    "/push/subscribe",
    response_model=MessageResponse,
    status_code=status.HTTP_201_CREATED,
)
async def push_subscribe(
    data: PushSubscriptionIn,
    user: CurrentUser,
    db: DbDep,
    request: Request,
) -> MessageResponse:
    """Register or refresh a browser Web Push subscription.

    The browser hands us the same endpoint URL each time the user re-grants
    permission, so we upsert by ``endpoint`` to avoid duplicate rows.
    """
    user_agent = data.user_agent or request.headers.get("user-agent")
    existing = (
        await db.execute(
            select(WebPushSubscription).where(WebPushSubscription.endpoint == data.endpoint)
        )
    ).scalar_one_or_none()
    if existing:
        existing.user_id = user.id
        existing.company_id = user.company_id
        existing.p256dh = data.keys.p256dh
        existing.auth = data.keys.auth
        if user_agent:
            existing.user_agent = user_agent[:500]
    else:
        db.add(
            WebPushSubscription(
                user_id=user.id,
                company_id=user.company_id,
                endpoint=data.endpoint,
                p256dh=data.keys.p256dh,
                auth=data.keys.auth,
                user_agent=user_agent[:500] if user_agent else None,
            )
        )
    await db.commit()
    return MessageResponse(message="subscribed")


@router.post("/push/unsubscribe", response_model=MessageResponse)
async def push_unsubscribe(
    data: PushSubscriptionIn, user: CurrentUser, db: DbDep
) -> MessageResponse:
    await db.execute(
        delete(WebPushSubscription).where(
            WebPushSubscription.endpoint == data.endpoint,
            WebPushSubscription.user_id == user.id,
        )
    )
    await db.commit()
    return MessageResponse(message="unsubscribed")
