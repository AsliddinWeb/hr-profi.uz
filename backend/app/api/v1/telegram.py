"""Per-company Telegram bot config + subscribers admin endpoints.

The admin types a bot token into the UI; the PUT handler validates it
against Telegram's ``getMe`` and stores the bot's id-derived username
alongside. Subscribers map a company employee to a chat_id + opt-in
category list; Phase 2's Celery task uses these rows to fan out
notifications.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy import select

from app.core.deps import CurrentUser, DbDep, TenantId, require_permission
from app.core.exceptions import (
    ConflictError,
    NotFoundError,
    ValidationAppError,
)
from app.models.employee import Employee
from app.models.notification import NotificationCategory
from app.models.telegram import TelegramSettings, TelegramSubscriber
from app.schemas.common import MessageResponse
from app.schemas.telegram import (
    TelegramEventDef,
    TelegramSettingsRead,
    TelegramSettingsUpdate,
    TelegramSubscriberCreate,
    TelegramSubscriberRead,
    TelegramSubscriberUpdate,
    TelegramTestSendIn,
)
from app.services import telegram_dispatch, telegram_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/telegram", tags=["telegram"])


# ----- helpers ---------------------------------------------------------------


def _ensure_settings_company_id(user: CurrentUser, tenant_id: UUID | None) -> UUID:
    """Resolve the company we operate on. OWNER must pick a tenant via the
    standard ``?company_id=...`` query; admin/HR are implicitly scoped."""
    cid = tenant_id or user.company_id
    if cid is None:
        raise ValidationAppError("company.not_found")
    return cid


def _to_settings_read(row: TelegramSettings) -> TelegramSettingsRead:
    return TelegramSettingsRead(
        id=row.id,
        bot_token_masked=telegram_service.mask_token(row.bot_token),
        bot_username=row.bot_username,
        bot_first_name=row.bot_first_name,
        is_active=row.is_active,
        last_verified_at=row.last_verified_at,
        updated_at=row.updated_at,
        event_filters=telegram_dispatch.normalize_event_filters(
            row.event_filters
        ),
    )


def _to_subscriber_read(
    row: TelegramSubscriber, employee_name: str | None
) -> TelegramSubscriberRead:
    return TelegramSubscriberRead(
        id=row.id,
        employee_id=row.employee_id,
        employee_full_name=employee_name,
        chat_id=row.chat_id,
        label=row.label,
        enabled_categories=[
            NotificationCategory(c) for c in (row.enabled_categories or [])
            if c in NotificationCategory._value2member_map_
        ],
        is_active=row.is_active,
        last_sent_at=row.last_sent_at,
        last_error=row.last_error,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def _get_or_create_settings(
    db: DbDep, company_id: UUID
) -> TelegramSettings:
    """Settings is upserted — one row per company. The admin UI calls GET
    before anything else, so we create the empty row here so later PUTs
    just update."""
    row = (
        await db.execute(
            select(TelegramSettings).where(
                TelegramSettings.company_id == company_id
            )
        )
    ).scalar_one_or_none()
    if row:
        return row
    # Seed sensible defaults so a freshly-configured tenant still
    # receives the alerts (anomalies + leave requests + device offline)
    # without having to tick every box manually.
    row = TelegramSettings(
        company_id=company_id,
        is_active=False,
        event_filters=telegram_dispatch.default_event_filters(),
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


# ----- Settings --------------------------------------------------------------


@router.get(
    "/settings",
    response_model=TelegramSettingsRead,
    dependencies=[Depends(require_permission("telegram.read"))],
)
async def get_settings(
    user: CurrentUser, db: DbDep, tenant_id: TenantId
) -> TelegramSettingsRead:
    cid = _ensure_settings_company_id(user, tenant_id)
    row = await _get_or_create_settings(db, cid)
    return _to_settings_read(row)


@router.put(
    "/settings",
    response_model=TelegramSettingsRead,
    dependencies=[Depends(require_permission("telegram.update"))],
)
async def update_settings(
    data: TelegramSettingsUpdate,
    user: CurrentUser,
    db: DbDep,
    tenant_id: TenantId,
) -> TelegramSettingsRead:
    """Set or clear the bot token.

    Clearing (``bot_token=None`` or empty string) disables the integration
    and wipes the cached bot metadata. Setting a value calls Telegram's
    ``getMe`` first — if it fails, we 422 with the upstream error so the
    admin can see exactly what's wrong (typo'd token, bot banned, etc.).
    """
    cid = _ensure_settings_company_id(user, tenant_id)
    row = await _get_or_create_settings(db, cid)

    # Event filters are partial-updates: applied first so the same PUT
    # that toggles a checkbox doesn't have to re-send the token.
    if data.event_filters is not None:
        row.event_filters = telegram_dispatch.merge_event_filters(
            row.event_filters, data.event_filters
        )

    # If no token field was sent at all, treat this as a filters-only update.
    if data.bot_token is None and data.event_filters is not None:
        await db.commit()
        await db.refresh(row)
        return _to_settings_read(row)

    token = (data.bot_token or "").strip()
    if not token:
        row.bot_token = None
        row.bot_username = None
        row.bot_first_name = None
        row.is_active = False
        row.last_verified_at = None
        await db.commit()
        await db.refresh(row)
        return _to_settings_read(row)

    # Validate via getMe before persisting; surface upstream error verbatim.
    try:
        me = await telegram_service.get_me(token)
    except telegram_service.TelegramAPIError as exc:
        raise ValidationAppError(
            "common.validation_failed", upstream=str(exc)
        ) from exc

    row.bot_token = token
    row.bot_username = (me.get("username") or "")[:100] or None
    row.bot_first_name = (me.get("first_name") or "")[:100] or None
    row.is_active = True
    row.last_verified_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(row)
    return _to_settings_read(row)


@router.get(
    "/events",
    response_model=list[TelegramEventDef],
    dependencies=[Depends(require_permission("telegram.read"))],
)
async def list_events() -> list[TelegramEventDef]:
    """Static catalogue of toggleable events for the admin UI."""
    return [
        TelegramEventDef(
            key=e.key,
            category=e.category.value,
            default=e.default,
        )
        for e in telegram_dispatch.TELEGRAM_EVENTS
    ]


@router.post(
    "/settings/test",
    response_model=MessageResponse,
    dependencies=[Depends(require_permission("telegram.update"))],
)
async def send_test_message(
    data: TelegramTestSendIn,
    user: CurrentUser,
    db: DbDep,
    tenant_id: TenantId,
) -> MessageResponse:
    """Helper for the admin UI's ``Send test`` button. Uses the stored
    token (must already be validated)."""
    cid = _ensure_settings_company_id(user, tenant_id)
    row = await _get_or_create_settings(db, cid)
    if not row.bot_token or not row.is_active:
        raise ValidationAppError("common.validation_failed", upstream="bot not configured")

    text = data.text or "Hr-Profi: test message from admin panel."
    try:
        await telegram_service.send_message(row.bot_token, data.chat_id, text)
    except telegram_service.TelegramAPIError as exc:
        raise ValidationAppError(
            "common.validation_failed", upstream=str(exc)
        ) from exc
    return MessageResponse(message="sent")


# ----- Subscribers -----------------------------------------------------------


@router.get(
    "/subscribers",
    response_model=list[TelegramSubscriberRead],
    dependencies=[Depends(require_permission("telegram.read"))],
)
async def list_subscribers(
    user: CurrentUser, db: DbDep, tenant_id: TenantId
) -> list[TelegramSubscriberRead]:
    cid = _ensure_settings_company_id(user, tenant_id)
    rows = (
        await db.execute(
            select(TelegramSubscriber)
            .where(TelegramSubscriber.company_id == cid)
            .order_by(TelegramSubscriber.created_at.desc())
        )
    ).scalars().all()

    if not rows:
        return []

    employee_ids = [r.employee_id for r in rows]
    name_map = dict(
        (
            await db.execute(
                select(Employee.id, Employee.full_name).where(
                    Employee.id.in_(employee_ids)
                )
            )
        ).all()
    )
    return [_to_subscriber_read(r, name_map.get(r.employee_id)) for r in rows]


@router.post(
    "/subscribers",
    response_model=TelegramSubscriberRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("telegram.update"))],
)
async def create_subscriber(
    data: TelegramSubscriberCreate,
    user: CurrentUser,
    db: DbDep,
    tenant_id: TenantId,
) -> TelegramSubscriberRead:
    cid = _ensure_settings_company_id(user, tenant_id)

    employee = (
        await db.execute(
            select(Employee).where(
                Employee.id == data.employee_id, Employee.company_id == cid
            )
        )
    ).scalar_one_or_none()
    if not employee:
        raise NotFoundError("employee.not_found")

    existing = (
        await db.execute(
            select(TelegramSubscriber).where(
                TelegramSubscriber.company_id == cid,
                TelegramSubscriber.employee_id == data.employee_id,
            )
        )
    ).scalar_one_or_none()
    if existing:
        raise ConflictError("common.conflict")

    row = TelegramSubscriber(
        company_id=cid,
        employee_id=data.employee_id,
        chat_id=data.chat_id.strip(),
        label=data.label,
        enabled_categories=[c.value for c in data.enabled_categories],
        is_active=data.is_active,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _to_subscriber_read(row, employee.full_name)


@router.patch(
    "/subscribers/{subscriber_id}",
    response_model=TelegramSubscriberRead,
    dependencies=[Depends(require_permission("telegram.update"))],
)
async def update_subscriber(
    subscriber_id: UUID,
    data: TelegramSubscriberUpdate,
    user: CurrentUser,
    db: DbDep,
    tenant_id: TenantId,
) -> TelegramSubscriberRead:
    cid = _ensure_settings_company_id(user, tenant_id)
    row = (
        await db.execute(
            select(TelegramSubscriber).where(
                TelegramSubscriber.id == subscriber_id,
                TelegramSubscriber.company_id == cid,
            )
        )
    ).scalar_one_or_none()
    if not row:
        raise NotFoundError("common.not_found")

    if data.chat_id is not None:
        row.chat_id = data.chat_id.strip()
    if data.label is not None:
        row.label = data.label
    if data.enabled_categories is not None:
        row.enabled_categories = [c.value for c in data.enabled_categories]
    if data.is_active is not None:
        row.is_active = data.is_active

    await db.commit()
    await db.refresh(row)

    emp_name = (
        await db.execute(
            select(Employee.full_name).where(Employee.id == row.employee_id)
        )
    ).scalar_one_or_none()
    return _to_subscriber_read(row, emp_name)


@router.delete(
    "/subscribers/{subscriber_id}",
    response_model=MessageResponse,
    dependencies=[Depends(require_permission("telegram.update"))],
)
async def delete_subscriber(
    subscriber_id: UUID,
    user: CurrentUser,
    db: DbDep,
    tenant_id: TenantId,
) -> MessageResponse:
    cid = _ensure_settings_company_id(user, tenant_id)
    row = (
        await db.execute(
            select(TelegramSubscriber).where(
                TelegramSubscriber.id == subscriber_id,
                TelegramSubscriber.company_id == cid,
            )
        )
    ).scalar_one_or_none()
    if not row:
        raise NotFoundError("common.not_found")
    await db.delete(row)
    await db.commit()
    return MessageResponse(message="deleted")


@router.get(
    "/categories",
    response_model=list[str],
    dependencies=[Depends(require_permission("telegram.read"))],
)
async def list_categories() -> list[str]:
    """Static list of subscribable notification categories, for the admin
    UI's checkbox group. ``SYSTEM`` is always enabled implicitly so we
    don't return it here."""
    return [
        c.value
        for c in NotificationCategory
        if c != NotificationCategory.SYSTEM
    ]
