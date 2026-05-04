"""Company schemas."""
from __future__ import annotations

from datetime import date, datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field

from app.models.company import CompanyPlan
from app.schemas.common import ORMBase


class CompanyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    slug: str = Field(min_length=2, max_length=64, pattern="^[a-z0-9][a-z0-9-_]*$")
    timezone: str = "Asia/Tashkent"
    currency: str = Field(default="UZS", max_length=8)
    country: str = Field(default="UZ", min_length=2, max_length=2)
    language_default: str = Field(default="uz", pattern="^(uz|ru|en)$")
    plan: CompanyPlan = CompanyPlan.FREE
    subscription_until: date | None = None


class CompanyCreateWithAdmin(CompanyCreate):
    """Owner uses this to spin up a new tenant with its first admin in one shot."""

    admin_username: str = Field(min_length=2, max_length=64)
    admin_email: EmailStr | None = None
    admin_password: str = Field(min_length=8, max_length=128)
    admin_full_name: str | None = Field(default=None, max_length=200)


class CompanyUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    logo_url: str | None = Field(default=None, max_length=500)
    timezone: str | None = None
    currency: str | None = Field(default=None, max_length=8)
    country: str | None = Field(default=None, min_length=2, max_length=2)
    language_default: str | None = Field(default=None, pattern="^(uz|ru|en)$")
    plan: CompanyPlan | None = None
    subscription_until: date | None = None
    settings: dict[str, Any] | None = None
    is_active: bool | None = None


class CompanySuspend(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


class CompanyRead(ORMBase):
    id: UUID
    name: str
    slug: str
    logo_url: str | None
    timezone: str
    currency: str
    country: str
    language_default: str
    plan: CompanyPlan
    subscription_until: date | None
    settings: dict[str, Any]
    is_active: bool
    suspended_at: datetime | None
    suspended_reason: str | None
    created_at: datetime
    updated_at: datetime


__all__ = [
    "CompanyCreate",
    "CompanyCreateWithAdmin",
    "CompanyRead",
    "CompanySuspend",
    "CompanyUpdate",
]
