"""Auth flows: login, refresh (rotating + device-bound), logout, password change."""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import and_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.exceptions import AuthenticationError, ConflictError, TokenError
from app.core.security import (
    REFRESH_TOKEN_TYPE,
    JWTError,
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.schemas.auth import LoginRequest, TokenPair


MAX_DEVICES_PER_USER = 2


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _lookup_user(db: AsyncSession, identifier: str) -> User | None:
    """Find user by username OR email. Tenant filter is bypassed because login
    happens before we know the tenant."""
    stmt = (
        select(User)
        .where((User.username == identifier) | (User.email == identifier))
        .execution_options(skip_tenant_filter=True)
    )
    result = await db.execute(stmt)
    return result.scalars().first()


async def _issue_token_pair(
    db: AsyncSession,
    user: User,
    *,
    device_id: UUID | None,
    device_name: str | None,
    device_platform: str | None,
    user_agent: str | None,
    ip_address: str | None,
) -> TokenPair:
    access = create_access_token(user.id, role=user.role, company_id=user.company_id)
    refresh, jti, expires_at = create_refresh_token(user.id, device_id=device_id)

    db.add(
        RefreshToken(
            user_id=user.id,
            jti=jti,
            device_id=device_id,
            device_name=device_name,
            device_platform=device_platform,
            user_agent=user_agent,
            ip_address=ip_address,
            expires_at=expires_at,
            is_active=True,
        )
    )
    await db.commit()

    return TokenPair(
        access_token=access,
        refresh_token=refresh,
        expires_in=settings.jwt_access_ttl_minutes * 60,
    )


async def _enforce_device_limit(db: AsyncSession, user_id: UUID, device_id: UUID | None) -> None:
    """If the user has reached the device cap, revoke the oldest active token
    that doesn't belong to ``device_id``. We don't reject the login; we rotate
    out the oldest device, which is the expected UX (signing in on phone #3
    automatically signs out phone #1)."""
    if device_id is None:
        return

    stmt = (
        select(RefreshToken)
        .where(
            RefreshToken.user_id == user_id,
            RefreshToken.is_active.is_(True),
            RefreshToken.revoked_at.is_(None),
        )
        .execution_options(skip_tenant_filter=True)
        .order_by(RefreshToken.created_at.asc())
    )
    rows = (await db.execute(stmt)).scalars().all()

    distinct_devices = {r.device_id for r in rows if r.device_id is not None}
    distinct_devices.add(device_id)
    if len(distinct_devices) <= MAX_DEVICES_PER_USER:
        return

    # Revoke the oldest token whose device is not the current one.
    for r in rows:
        if r.device_id != device_id:
            r.is_active = False
            r.revoked_at = _now()
            break


async def login(
    db: AsyncSession,
    data: LoginRequest,
    *,
    user_agent: str | None,
    ip_address: str | None,
) -> tuple[User, TokenPair]:
    user = await _lookup_user(db, data.username)
    if not user or not user.is_active:
        raise AuthenticationError()
    if not verify_password(data.password, user.password_hash):
        raise AuthenticationError()

    await _enforce_device_limit(db, user.id, data.device_id)
    pair = await _issue_token_pair(
        db,
        user,
        device_id=data.device_id,
        device_name=data.device_name,
        device_platform=data.device_platform,
        user_agent=user_agent,
        ip_address=ip_address,
    )
    return user, pair


async def refresh(
    db: AsyncSession,
    refresh_token_str: str,
    *,
    user_agent: str | None,
    ip_address: str | None,
) -> TokenPair:
    """Rotating refresh: validate, mark current as used, issue new pair."""
    try:
        payload = decode_token(refresh_token_str)
    except JWTError as e:
        raise TokenError() from e

    if payload.get("type") != REFRESH_TOKEN_TYPE:
        raise TokenError("auth.invalid_token_type")

    jti = payload.get("jti")
    sub = payload.get("sub")
    device_id_raw = payload.get("device_id")
    if not jti or not sub:
        raise TokenError()

    device_id = UUID(device_id_raw) if device_id_raw else None
    user_id = UUID(sub)

    stmt = (
        select(RefreshToken)
        .where(
            RefreshToken.jti == jti,
            RefreshToken.user_id == user_id,
        )
        .execution_options(skip_tenant_filter=True)
    )
    token_row = (await db.execute(stmt)).scalar_one_or_none()
    if not token_row or not token_row.is_active or token_row.revoked_at is not None:
        # Reuse of a revoked refresh token is suspicious — revoke the whole
        # device chain so an attacker who stole a token can't keep refreshing.
        if token_row is not None:
            await db.execute(
                update(RefreshToken)
                .where(
                    and_(
                        RefreshToken.user_id == user_id,
                        RefreshToken.device_id == token_row.device_id,
                        RefreshToken.is_active.is_(True),
                    )
                )
                .values(is_active=False, revoked_at=_now())
                .execution_options(skip_tenant_filter=True)
            )
            await db.commit()
        raise TokenError()

    if token_row.expires_at < _now():
        raise TokenError("auth.token_expired")

    user_stmt = select(User).where(User.id == user_id).execution_options(skip_tenant_filter=True)
    user = (await db.execute(user_stmt)).scalar_one_or_none()
    if not user or not user.is_active:
        raise AuthenticationError()

    # Mark current as rotated.
    token_row.is_active = False
    token_row.revoked_at = _now()

    new_pair = await _issue_token_pair(
        db,
        user,
        device_id=device_id,
        device_name=token_row.device_name,
        device_platform=token_row.device_platform,
        user_agent=user_agent,
        ip_address=ip_address,
    )
    return new_pair


async def logout(
    db: AsyncSession,
    user_id: UUID,
    *,
    refresh_token_str: str | None,
    all_devices: bool,
) -> None:
    """Revoke either a single refresh token or all of the user's devices."""
    q = (
        update(RefreshToken)
        .where(
            RefreshToken.user_id == user_id,
            RefreshToken.is_active.is_(True),
        )
        .values(is_active=False, revoked_at=_now())
        .execution_options(skip_tenant_filter=True)
    )

    if not all_devices and refresh_token_str:
        try:
            payload = decode_token(refresh_token_str)
            jti = payload.get("jti")
        except JWTError:
            jti = None
        if jti:
            q = q.where(RefreshToken.jti == jti)

    await db.execute(q)
    await db.commit()


async def change_password(
    db: AsyncSession,
    user: User,
    *,
    current_password: str,
    new_password: str,
) -> None:
    if not verify_password(current_password, user.password_hash):
        raise AuthenticationError()
    if verify_password(new_password, user.password_hash):
        raise ConflictError("auth.password_unchanged")
    user.password_hash = hash_password(new_password)
    # Revoke all existing refresh tokens — force re-login on every device.
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user.id, RefreshToken.is_active.is_(True))
        .values(is_active=False, revoked_at=_now())
        .execution_options(skip_tenant_filter=True)
    )
    await db.commit()


async def reset_password_admin(
    db: AsyncSession,
    target_user: User,
    *,
    new_password: str,
) -> None:
    """Admin-driven reset (no email loop in MVP). Caller must have already
    enforced that the actor has permission and that target is in the same
    tenant."""
    target_user.password_hash = hash_password(new_password)
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == target_user.id, RefreshToken.is_active.is_(True))
        .values(is_active=False, revoked_at=_now())
        .execution_options(skip_tenant_filter=True)
    )
    await db.commit()


__all__ = [
    "MAX_DEVICES_PER_USER",
    "change_password",
    "login",
    "logout",
    "refresh",
    "reset_password_admin",
]
