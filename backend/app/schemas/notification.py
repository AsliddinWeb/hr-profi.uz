"""Notification schemas."""
from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.notification import NotificationCategory
from app.schemas.common import ORMBase


class NotificationRead(ORMBase):
    id: UUID
    company_id: UUID | None
    user_id: UUID
    category: NotificationCategory
    title: str
    body: str | None
    payload: dict[str, Any] | None
    is_read: bool
    read_at: datetime | None
    created_at: datetime


class NotificationCreate(BaseModel):
    user_id: UUID
    category: NotificationCategory = NotificationCategory.SYSTEM
    title: str = Field(min_length=1, max_length=200)
    body: str | None = Field(default=None, max_length=1000)
    payload: dict[str, Any] | None = None


class NotificationPreferenceItem(BaseModel):
    category: NotificationCategory
    enabled: bool


class NotificationPreferences(BaseModel):
    """Bulk read/write of all category opt-ins for the caller."""

    items: list[NotificationPreferenceItem]


__all__ = [
    "NotificationCreate",
    "NotificationPreferenceItem",
    "NotificationPreferences",
    "NotificationRead",
]
