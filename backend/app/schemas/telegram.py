"""Telegram bot settings + subscribers schemas."""
from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.notification import NotificationCategory
from app.schemas.common import ORMBase


# ---- Settings ----------------------------------------------------------------


class TelegramSettingsRead(ORMBase):
    """What we send to the admin UI. The token is *masked* — we never echo
    the raw value back to the client once it's stored."""

    id: UUID
    bot_token_masked: str | None = None
    bot_username: str | None
    bot_first_name: str | None
    is_active: bool
    last_verified_at: datetime | None
    updated_at: datetime
    event_filters: dict[str, bool] = Field(default_factory=dict)


class TelegramSettingsUpdate(BaseModel):
    """PUT body. Sending ``bot_token=None`` clears the integration;
    sending a value re-validates against Telegram's getMe.

    ``event_filters`` is a *partial* update — keys present overwrite,
    keys missing are left alone. Useful so the UI can toggle a single
    event without GET-then-PUT round-trips.
    """

    bot_token: str | None = Field(default=None, max_length=255)
    event_filters: dict[str, bool] | None = None


class TelegramEventDef(BaseModel):
    """Metadata for one toggleable event. The admin UI uses this to
    render the checkbox list — labels are i18n'd client-side off the
    ``key``."""

    key: str
    category: str
    default: bool


class TelegramTestSendIn(BaseModel):
    """Admin-side ``send test message`` helper. ``chat_id`` is required so
    the admin can verify a specific binding without disturbing other
    subscribers."""

    chat_id: str = Field(min_length=1, max_length=64)
    text: str | None = Field(default=None, max_length=500)


# ---- Subscribers -------------------------------------------------------------


class TelegramSubscriberRead(ORMBase):
    id: UUID
    user_id: UUID
    user_full_name: str | None = None
    user_username: str | None = None
    user_role: str | None = None
    chat_id: str
    label: str | None
    enabled_categories: list[NotificationCategory]
    is_active: bool
    last_sent_at: datetime | None
    last_error: str | None
    created_at: datetime
    updated_at: datetime


class TelegramSubscriberCreate(BaseModel):
    user_id: UUID
    chat_id: str = Field(min_length=1, max_length=64)
    label: str | None = Field(default=None, max_length=200)
    enabled_categories: list[NotificationCategory] = Field(default_factory=list)
    is_active: bool = True


class TelegramSubscriberUpdate(BaseModel):
    chat_id: str | None = Field(default=None, min_length=1, max_length=64)
    label: str | None = Field(default=None, max_length=200)
    enabled_categories: list[NotificationCategory] | None = None
    is_active: bool | None = None


__all__ = [
    "TelegramEventDef",
    "TelegramSettingsRead",
    "TelegramSettingsUpdate",
    "TelegramSubscriberCreate",
    "TelegramSubscriberRead",
    "TelegramSubscriberUpdate",
    "TelegramTestSendIn",
]
