"""Generic image upload endpoint.

The frontend calls ``POST /uploads/image?folder=branches`` with a multipart
``file`` field. Returns the public URL — the caller then stores that URL on the
relevant resource (Branch.photo_url, Employee.photo_url, …).

Tenant scoping is enforced from the JWT: an OWNER without ``?company_id=`` cannot
upload, since there is no tenant to namespace the object under.
"""
from __future__ import annotations

import re

from fastapi import APIRouter, Depends, File, Query, UploadFile, status
from pydantic import BaseModel

from app.core.deps import CurrentUser, TenantId
from app.core.exceptions import PermissionDeniedError, ValidationAppError
from app.core.permissions import Role
from app.services import storage_service

router = APIRouter(prefix="/uploads", tags=["uploads"])

_FOLDER_RE = re.compile(r"^[a-z][a-z0-9_-]{1,32}$")


class UploadImageResponse(BaseModel):
    url: str


@router.post(
    "/image",
    response_model=UploadImageResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_image(
    user: CurrentUser,
    tenant: TenantId,
    file: UploadFile = File(..., description="JPEG/PNG/WebP, max 5MB"),
    folder: str = Query("misc", description="Tenant subfolder, e.g. 'branches'"),
) -> UploadImageResponse:
    if user.role == Role.OWNER and tenant is None:
        # OWNER must scope their upload to a specific tenant; otherwise the
        # object would have no company_id prefix and would leak across tenants.
        raise PermissionDeniedError("uploads.tenant_required")
    company_id = tenant or user.company_id
    if company_id is None:
        raise PermissionDeniedError()

    if not _FOLDER_RE.match(folder):
        raise ValidationAppError("uploads.invalid_folder")

    # Read into memory to know length (UploadFile.file is a SpooledTemporaryFile;
    # length is available after .seek(0, 2)).
    blob = await file.read()
    try:
        url = storage_service.upload_image_bytes(
            company_id=company_id,
            module=folder,
            data=blob,
            content_type=file.content_type or "application/octet-stream",
        )
    except ValueError as e:
        raise ValidationAppError(str(e)) from e

    return UploadImageResponse(url=url)


__all__ = ["router"]
