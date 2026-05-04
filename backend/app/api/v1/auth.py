"""Auth router: login, refresh, logout, me, password change."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status

from app.core.deps import (
    CurrentUser,
    DbDep,
    LangDep,
    client_ip,
    user_agent,
)
from app.schemas.auth import (
    LoginRequest,
    LogoutRequest,
    PasswordChangeRequest,
    RefreshRequest,
    TokenPair,
)
from app.schemas.common import MessageResponse
from app.schemas.user import UserRead, UserSelfUpdate
from app.services import auth_service, audit_service

router = APIRouter(prefix="/auth", tags=["auth"])

UA = Annotated[str | None, Depends(user_agent)]
IP = Annotated[str | None, Depends(client_ip)]


@router.post("/login", response_model=TokenPair, status_code=status.HTTP_200_OK)
async def login(
    data: LoginRequest,
    db: DbDep,
    ua: UA,
    ip: IP,
    _: LangDep,
) -> TokenPair:
    user, pair = await auth_service.login(db, data, user_agent=ua, ip_address=ip)
    await audit_service.record(
        db,
        action="auth.login",
        actor_id=user.id,
        actor_role=user.role,
        company_id=user.company_id,
        ip_address=ip,
        user_agent=ua,
        commit=True,
    )
    return pair


@router.post("/refresh", response_model=TokenPair)
async def refresh(
    data: RefreshRequest,
    db: DbDep,
    ua: UA,
    ip: IP,
    _: LangDep,
) -> TokenPair:
    return await auth_service.refresh(db, data.refresh_token, user_agent=ua, ip_address=ip)


@router.post("/logout", response_model=MessageResponse)
async def logout(
    data: LogoutRequest,
    user: CurrentUser,
    db: DbDep,
    ip: IP,
    ua: UA,
    lang: LangDep,
) -> MessageResponse:
    await auth_service.logout(
        db, user.id, refresh_token_str=data.refresh_token, all_devices=data.all_devices
    )
    await audit_service.record(
        db,
        action="auth.logout",
        actor_id=user.id,
        actor_role=user.role,
        company_id=user.company_id,
        ip_address=ip,
        user_agent=ua,
        payload={"all_devices": data.all_devices},
        commit=True,
    )
    from app.core.i18n import translate

    return MessageResponse(message=translate("auth.logged_out", lang))


@router.get("/me", response_model=UserRead)
async def me(user: CurrentUser, _: LangDep) -> UserRead:
    return UserRead.model_validate(user)


@router.patch("/me", response_model=UserRead)
async def update_me(
    data: UserSelfUpdate, user: CurrentUser, db: DbDep, _: LangDep
) -> UserRead:
    """Self-service profile update. Only the bio fields — role/status/active
    are excluded by the schema, so a user can never escalate themselves."""
    payload = data.model_dump(exclude_unset=True)
    for field, value in payload.items():
        setattr(user, field, value)
    await db.commit()
    await db.refresh(user)
    return UserRead.model_validate(user)


@router.post("/password/change", response_model=MessageResponse)
async def change_password(
    data: PasswordChangeRequest,
    user: CurrentUser,
    db: DbDep,
    ip: IP,
    ua: UA,
    lang: LangDep,
) -> MessageResponse:
    await auth_service.change_password(
        db,
        user,
        current_password=data.current_password,
        new_password=data.new_password,
    )
    await audit_service.record(
        db,
        action="auth.password_change",
        actor_id=user.id,
        actor_role=user.role,
        company_id=user.company_id,
        ip_address=ip,
        user_agent=ua,
        commit=True,
    )
    from app.core.i18n import translate

    return MessageResponse(message=translate("auth.password_changed", lang))
