"""Auth dependency for the tablet kiosk runtime.

Kiosks aren't ``User`` rows — they're rows in the ``kiosks`` table. The
runtime endpoints (``/kiosks/me/*``) are hit by a tablet, not a person,
so we need a dep that loads a ``Kiosk`` from the JWT instead of the
``User`` that ``get_current_user`` expects.

The JWT itself is minted by the public ``POST /kiosks/auth/login``
endpoint with ``sub = kiosk.id`` and ``role = "KIOSK"``.
"""
from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import Depends, Request
from sqlalchemy import select

from app.core.deps import DbDep, oauth2_scheme
from app.core.exceptions import AuthenticationError, TokenError
from app.core.permissions import Role
from app.core.security import ACCESS_TOKEN_TYPE, JWTError, decode_token
from app.core.tenant import set_current_tenant
from app.models.kiosk import Kiosk


async def get_current_kiosk(
    request: Request,
    db: DbDep,
    token: Annotated[str | None, Depends(oauth2_scheme)] = None,
) -> Kiosk:
    if not token:
        raise AuthenticationError()
    try:
        payload = decode_token(token)
    except JWTError as e:
        raise TokenError() from e

    if payload.get("type") != ACCESS_TOKEN_TYPE:
        raise TokenError("auth.invalid_token_type")
    if payload.get("role") != Role.KIOSK.value:
        raise TokenError("auth.wrong_role_for_kiosk")

    sub = payload.get("sub")
    if not sub:
        raise TokenError()
    try:
        kiosk_id = UUID(sub)
    except (TypeError, ValueError) as e:
        raise TokenError() from e

    kiosk = (
        await db.execute(
            select(Kiosk)
            .where(Kiosk.id == kiosk_id)
            .execution_options(skip_tenant_filter=True)
        )
    ).scalar_one_or_none()
    if kiosk is None or not kiosk.is_active:
        raise AuthenticationError()

    # Pin the tenant ContextVar so subsequent ORM queries inside the
    # request scope are auto-filtered to the kiosk's company.
    set_current_tenant(kiosk.company_id)
    request.state.kiosk = kiosk
    request.state.role = Role.KIOSK.value
    return kiosk


CurrentKiosk = Annotated[Kiosk, Depends(get_current_kiosk)]


__all__ = ["CurrentKiosk", "get_current_kiosk"]
