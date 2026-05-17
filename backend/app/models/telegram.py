"""Telegram bot integration.

One ``TelegramSettings`` row per company holds the bot token. Each
``TelegramSubscriber`` links a specific Employee to a Telegram
``chat_id`` + a list of notification categories they want to receive.

Outbound flow: ``notification_service.notify(...)`` creates a
``Notification`` row, a celery task picks it up and forwards to every
matching subscriber via Telegram's Bot API.

We deliberately keep the token + chat_id on the SAME tables that the
admin UI manages — a separate `bot_run.py` long-poller can read them
later if/when we add inbound /start support.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TenantMixin, TimestampMixin


class TelegramSettings(Base, TenantMixin, TimestampMixin):
    """Per-company bot configuration. Lazily upserted by the admin UI;
    a company without a row simply has no Telegram integration."""

    __tablename__ = "telegram_settings"
    __table_args__ = (
        UniqueConstraint("company_id", name="uq_telegram_settings_company"),
    )

    bot_token: Mapped[str | None] = mapped_column(String(255))
    # Stamped from Telegram's ``getMe`` response after a successful
    # validation. Read-only for the admin — they type the token, we
    # fill the username.
    bot_username: Mapped[str | None] = mapped_column(String(100))
    bot_first_name: Mapped[str | None] = mapped_column(String(100))
    # Flips to True once getMe succeeded. Outbound sends are skipped
    # while False so a half-configured tenant doesn't fire half-broken
    # messages.
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    last_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Per-event forwarding toggles. Keys are stable event identifiers
    # (see ``app.services.telegram_dispatch.TELEGRAM_EVENTS``); values
    # are booleans. Missing key = off. Lets the admin enable e.g.
    # ``check_in`` / ``late_check_in`` independently of the
    # ATTENDANCE notification category so the in-app bell doesn't get
    # spammed with one row per check-in.
    event_filters: Mapped[dict | None] = mapped_column(
        JSON, default=dict
    )


class TelegramSubscriber(Base, TenantMixin, TimestampMixin):
    """One User (admin/HR/manager) → one chat_id → opt-in notification
    categories.

    Subscribers are bosses watching the business — not the employees
    being watched. We bind to ``User`` (not ``Employee``) so the admin
    can pick from COMPANY_ADMIN / HR_MANAGER / BRANCH_MANAGER accounts
    instead of scrolling through warehouse staff in the employees
    list.

    ``enabled_categories`` is a JSON list of ``NotificationCategory``
    string values. Missing / empty list means "subscribe to nothing";
    presence in the list means subscribed. Admin can toggle each
    category per subscriber.

    The (company_id, user_id) uniqueness keeps a single Telegram
    binding per user — if the operator wants to switch chats, they
    update the chat_id in place, not duplicate the row.
    """

    __tablename__ = "telegram_subscribers"
    __table_args__ = (
        UniqueConstraint(
            "company_id", "user_id", name="uq_telegram_subscriber_user"
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    chat_id: Mapped[str] = mapped_column(String(64), nullable=False)
    # Admin-facing display name. Optional (we can show the linked
    # employee's full_name); kept around so admin can put e.g. "Boss
    # — emergency line".
    label: Mapped[str | None] = mapped_column(String(200))
    enabled_categories: Mapped[list[str] | None] = mapped_column(
        JSON, default=list
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(String(500))


__all__ = ["TelegramSettings", "TelegramSubscriber"]
