"""JWT + password hashing primitives."""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=settings.bcrypt_rounds)

ACCESS_TOKEN_TYPE = "access"
REFRESH_TOKEN_TYPE = "refresh"


def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def create_access_token(
    subject: str | UUID,
    *,
    role: str,
    company_id: UUID | None,
    extra: dict[str, Any] | None = None,
) -> str:
    now = _now()
    payload: dict[str, Any] = {
        "sub": str(subject),
        "type": ACCESS_TOKEN_TYPE,
        "role": role,
        "company_id": str(company_id) if company_id else None,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.jwt_access_ttl_minutes)).timestamp()),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


def create_refresh_token(
    subject: str | UUID,
    *,
    device_id: UUID | None = None,
    jti: str | None = None,
) -> tuple[str, str, datetime]:
    """Returns (token, jti, expires_at). jti is what we store server-side for rotation/revocation."""
    now = _now()
    expires_at = now + timedelta(days=settings.jwt_refresh_ttl_days)
    jti = jti or secrets.token_urlsafe(32)
    payload = {
        "sub": str(subject),
        "type": REFRESH_TOKEN_TYPE,
        "device_id": str(device_id) if device_id else None,
        "jti": jti,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
    }
    token = jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)
    return token, jti, expires_at


def decode_token(token: str) -> dict[str, Any]:
    """Raises JWTError on invalid/expired token. Caller should catch and convert."""
    return jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])


__all__ = [
    "ACCESS_TOKEN_TYPE",
    "REFRESH_TOKEN_TYPE",
    "JWTError",
    "create_access_token",
    "create_refresh_token",
    "decode_token",
    "hash_password",
    "verify_password",
]
