"""Kiosk CRUD (admin) + login endpoint (public on kiosk.hr-profi.uz).

Admin endpoints follow the same shape as ``/devices``. The login
endpoint is unauthenticated — it accepts a slug + password and issues
a short-lived JWT scoped to the kiosk.

Phase 1+2 — face-recognition / check-in / check-out endpoints land in
the next phase.
"""
from __future__ import annotations

import re
import secrets
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import desc, func, or_, select

from app.config import settings
from app.core.deps import (
    CurrentUser,
    DbDep,
    TenantId,
    require_permission,
)
from app.core.exceptions import (
    NotFoundError,
    PermissionDeniedError,
    ValidationAppError,
)
from app.core.permissions import Role
from app.core.security import create_access_token, hash_password, verify_password
from app.models.branch import Branch
from app.models.kiosk import Kiosk
from app.schemas.common import MessageResponse, Page
from app.schemas.kiosk import (
    KioskCreate,
    KioskCreateResponse,
    KioskLoginRequest,
    KioskLoginResponse,
    KioskRead,
    KioskResetPassword,
    KioskUpdate,
)

router = APIRouter(prefix="/kiosks", tags=["kiosks"])


def _company_id(user, tenant) -> UUID:
    cid = tenant or user.company_id
    if cid is None:
        raise PermissionDeniedError()
    return cid


def _slugify(name: str) -> str:
    """Generate a URL slug from a kiosk name. Lowercases, strips non-Latin
    chars, collapses whitespace to ``-``."""
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "-", name.lower()).strip("-")
    return cleaned[:64] or "kiosk"


async def _ensure_unique_slug(
    db, company_id: UUID, base_slug: str, *, exclude_id: UUID | None = None
) -> str:
    """Append ``-N`` until the slug doesn't collide within the company."""
    slug = base_slug
    i = 2
    while True:
        stmt = select(Kiosk.id).where(
            Kiosk.company_id == company_id, Kiosk.slug == slug
        )
        if exclude_id is not None:
            stmt = stmt.where(Kiosk.id != exclude_id)
        existing = (await db.execute(stmt)).scalar_one_or_none()
        if existing is None:
            return slug
        slug = f"{base_slug}-{i}"
        i += 1


def _login_url(slug: str) -> str:
    """Public URL the operator hands to the tablet. Resolved from the
    company domain so a future move to a separate ``kiosk.<DOMAIN>`` is
    one config change."""
    base = f"https://kiosk.{settings.domain}".rstrip("/")
    return f"{base}/{slug}"


# ---------- Admin CRUD -------------------------------------------------------

@router.get(
    "",
    response_model=Page[KioskRead],
    dependencies=[Depends(require_permission("kiosk.read"))],
)
async def list_kiosks(
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    q: str | None = None,
    is_active: bool | None = None,
) -> Page[KioskRead]:
    company_id = _company_id(user, tenant)

    stmt = select(Kiosk).where(Kiosk.company_id == company_id)
    count_stmt = select(func.count(Kiosk.id)).where(Kiosk.company_id == company_id)

    # Branch managers see only their own branch's kiosks.
    if user.role == Role.BRANCH_MANAGER and user.branch_id is not None:
        stmt = stmt.where(Kiosk.branch_id == user.branch_id)
        count_stmt = count_stmt.where(Kiosk.branch_id == user.branch_id)

    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(or_(func.lower(Kiosk.name).like(like), func.lower(Kiosk.slug).like(like)))
        count_stmt = count_stmt.where(
            or_(func.lower(Kiosk.name).like(like), func.lower(Kiosk.slug).like(like))
        )
    if is_active is not None:
        stmt = stmt.where(Kiosk.is_active.is_(is_active))
        count_stmt = count_stmt.where(Kiosk.is_active.is_(is_active))

    total = (await db.execute(count_stmt)).scalar_one()
    rows = (
        await db.execute(
            stmt.order_by(desc(Kiosk.created_at)).offset((page - 1) * size).limit(size)
        )
    ).scalars().all()
    return Page[KioskRead](
        items=[KioskRead.model_validate(r) for r in rows],
        total=total,
        page=page,
        size=size,
    )


@router.post(
    "",
    response_model=KioskCreateResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("kiosk.create"))],
)
async def create_kiosk(
    data: KioskCreate,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> KioskCreateResponse:
    company_id = _company_id(user, tenant)

    # Branch must belong to this company. Branch managers can only create
    # kiosks for their own branch.
    branch = (
        await db.execute(
            select(Branch).where(
                Branch.id == data.branch_id, Branch.company_id == company_id
            )
        )
    ).scalar_one_or_none()
    if branch is None:
        raise ValidationAppError("kiosk.branch_not_found")
    if (
        user.role == Role.BRANCH_MANAGER
        and user.branch_id is not None
        and user.branch_id != data.branch_id
    ):
        raise PermissionDeniedError()

    base_slug = _slugify(data.slug or data.name)
    slug = await _ensure_unique_slug(db, company_id, base_slug)

    kiosk = Kiosk(
        company_id=company_id,
        branch_id=data.branch_id,
        name=data.name.strip(),
        slug=slug,
        password_hash=hash_password(data.password),
        notes=data.notes,
        is_active=True,
    )
    db.add(kiosk)
    await db.commit()
    await db.refresh(kiosk)

    return KioskCreateResponse(
        kiosk=KioskRead.model_validate(kiosk),
        login_url=_login_url(slug),
        password=data.password,
    )


async def _get_kiosk(db, kiosk_id: UUID, user) -> Kiosk:
    kiosk = (
        await db.execute(select(Kiosk).where(Kiosk.id == kiosk_id))
    ).scalar_one_or_none()
    if not kiosk:
        raise NotFoundError("kiosk.not_found")
    if (
        user.role == Role.BRANCH_MANAGER
        and user.branch_id is not None
        and kiosk.branch_id != user.branch_id
    ):
        raise NotFoundError("kiosk.not_found")  # hide existence
    return kiosk


@router.get(
    "/{kiosk_id}",
    response_model=KioskRead,
    dependencies=[Depends(require_permission("kiosk.read"))],
)
async def get_kiosk(
    kiosk_id: UUID,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> KioskRead:
    _company_id(user, tenant)
    kiosk = await _get_kiosk(db, kiosk_id, user)
    return KioskRead.model_validate(kiosk)


@router.patch(
    "/{kiosk_id}",
    response_model=KioskRead,
    dependencies=[Depends(require_permission("kiosk.update"))],
)
async def update_kiosk(
    kiosk_id: UUID,
    data: KioskUpdate,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> KioskRead:
    company_id = _company_id(user, tenant)
    kiosk = await _get_kiosk(db, kiosk_id, user)
    diff = data.model_dump(exclude_unset=True)

    if "branch_id" in diff and diff["branch_id"] is not None:
        # Validate target branch.
        target = (
            await db.execute(
                select(Branch).where(
                    Branch.id == diff["branch_id"], Branch.company_id == company_id
                )
            )
        ).scalar_one_or_none()
        if target is None:
            raise ValidationAppError("kiosk.branch_not_found")
        if (
            user.role == Role.BRANCH_MANAGER
            and user.branch_id is not None
            and user.branch_id != diff["branch_id"]
        ):
            raise PermissionDeniedError()

    if "slug" in diff and diff["slug"]:
        diff["slug"] = await _ensure_unique_slug(
            db, company_id, _slugify(diff["slug"]), exclude_id=kiosk.id
        )

    for f, v in diff.items():
        setattr(kiosk, f, v)
    await db.commit()
    await db.refresh(kiosk)
    return KioskRead.model_validate(kiosk)


@router.post(
    "/{kiosk_id}/reset-password",
    response_model=KioskCreateResponse,
    dependencies=[Depends(require_permission("kiosk.update"))],
)
async def reset_kiosk_password(
    kiosk_id: UUID,
    data: KioskResetPassword,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> KioskCreateResponse:
    _company_id(user, tenant)
    kiosk = await _get_kiosk(db, kiosk_id, user)
    kiosk.password_hash = hash_password(data.password)
    await db.commit()
    await db.refresh(kiosk)
    return KioskCreateResponse(
        kiosk=KioskRead.model_validate(kiosk),
        login_url=_login_url(kiosk.slug),
        password=data.password,
    )


@router.delete(
    "/{kiosk_id}",
    response_model=MessageResponse,
    dependencies=[Depends(require_permission("kiosk.delete"))],
)
async def delete_kiosk(
    kiosk_id: UUID,
    user: CurrentUser,
    db: DbDep,
    tenant: TenantId,
) -> MessageResponse:
    _company_id(user, tenant)
    kiosk = await _get_kiosk(db, kiosk_id, user)
    # Soft-delete: keep the row so audit logs / past attendance referencing
    # the kiosk continue to resolve.
    kiosk.is_active = False
    # Bcrypt of a random string — invalidates the existing password without
    # leaving a usable one in DB. Operator must reset to re-enable.
    kiosk.password_hash = hash_password(secrets.token_urlsafe(48))
    await db.commit()
    return MessageResponse(message="deactivated")


# ---------- Public auth (kiosk.hr-profi.uz) ---------------------------------

@router.post(
    "/auth/login",
    response_model=KioskLoginResponse,
)
async def kiosk_login(
    data: KioskLoginRequest,
    db: DbDep,
) -> KioskLoginResponse:
    """Slug + password → JWT scoped to ``role=KIOSK``.

    No tenant filter is applied — the caller is unauthenticated by
    definition, and slug lookup is global. We do filter ``is_active``
    so a soft-deleted kiosk can never log in.
    """
    kiosk = (
        await db.execute(
            select(Kiosk)
            .where(Kiosk.slug == data.slug, Kiosk.is_active.is_(True))
            .execution_options(skip_tenant_filter=True)
        )
    ).scalar_one_or_none()
    if kiosk is None or not verify_password(data.password, kiosk.password_hash):
        raise ValidationAppError("kiosk.invalid_credentials")

    kiosk.last_seen_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(kiosk)

    token = create_access_token(
        subject=kiosk.id,
        role=Role.KIOSK.value,
        company_id=kiosk.company_id,
        extra={
            "kiosk_id": str(kiosk.id),
            "branch_id": str(kiosk.branch_id),
        },
    )
    return KioskLoginResponse(
        access_token=token,
        kiosk=KioskRead.model_validate(kiosk),
    )


__all__ = ["router"]
