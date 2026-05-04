"""User schemas."""
from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field

from app.core.permissions import Role
from app.models.user import UserStatus
from app.schemas.common import ORMBase


class UserCreate(BaseModel):
    company_id: UUID | None = None  # required for non-OWNER roles
    branch_id: UUID | None = None  # required when role=BRANCH_MANAGER
    username: str = Field(min_length=2, max_length=64)
    email: EmailStr | None = None
    password: str = Field(min_length=8, max_length=128)
    role: Role
    full_name: str | None = Field(default=None, max_length=200)
    phone: str | None = Field(default=None, max_length=32)
    language: str = Field(default="uz", pattern="^(uz|ru|en)$")


class UserUpdate(BaseModel):
    email: EmailStr | None = None
    full_name: str | None = Field(default=None, max_length=200)
    phone: str | None = Field(default=None, max_length=32)
    language: str | None = Field(default=None, pattern="^(uz|ru|en)$")
    status: UserStatus | None = None
    is_active: bool | None = None
    # Re-assign a BRANCH_MANAGER to a different branch, or clear it. Setting
    # this on a non-BM is allowed (defensively no-op'd by the listener) but
    # the UI only shows it for BMs.
    branch_id: UUID | None = None


class UserSelfUpdate(BaseModel):
    """Self-service profile update — only fields a user can change about
    themselves. Role, status, is_active are intentionally absent."""

    email: EmailStr | None = None
    full_name: str | None = Field(default=None, max_length=200)
    phone: str | None = Field(default=None, max_length=32)
    language: str | None = Field(default=None, pattern="^(uz|ru|en)$")


class UserRead(ORMBase):
    id: UUID
    company_id: UUID | None
    branch_id: UUID | None
    username: str
    email: str | None
    role: Role
    status: UserStatus
    full_name: str | None
    phone: str | None
    language: str
    is_active: bool
    two_factor_enabled: bool
    created_at: datetime
    updated_at: datetime


__all__ = ["UserCreate", "UserRead", "UserSelfUpdate", "UserUpdate"]
