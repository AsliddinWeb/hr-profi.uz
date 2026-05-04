"""Auth-related request/response schemas."""
from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, EmailStr, Field


class LoginRequest(BaseModel):
    username: str = Field(min_length=2, max_length=255, description="username yoki email")
    password: str = Field(min_length=1, max_length=128)
    device_id: UUID | None = None
    device_name: str | None = None
    device_platform: str | None = Field(default=None, pattern="^(ios|android|web)$")


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int  # seconds until access token expires


class RefreshRequest(BaseModel):
    refresh_token: str


class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


class PasswordResetRequest(BaseModel):
    """Admin-initiated password reset for an employee (no email loop in MVP)."""

    user_id: UUID
    new_password: str = Field(min_length=8, max_length=128)


class LogoutRequest(BaseModel):
    refresh_token: str | None = None
    all_devices: bool = False


class RegisterDeviceRequest(BaseModel):
    device_id: UUID
    device_name: str
    device_platform: str = Field(pattern="^(ios|android|web)$")


class _Email(BaseModel):
    """Helper just for email validation in tests / future endpoints."""

    email: EmailStr


__all__ = [
    "LoginRequest",
    "LogoutRequest",
    "PasswordChangeRequest",
    "PasswordResetRequest",
    "RefreshRequest",
    "RegisterDeviceRequest",
    "TokenPair",
]
