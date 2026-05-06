"""Pydantic schemas for the tablet kiosk subsystem."""
from __future__ import annotations

from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints

from app.schemas.common import ORMBase


SlugStr = Annotated[
    str,
    StringConstraints(min_length=3, max_length=64, pattern=r"^[a-z][a-z0-9-]*[a-z0-9]$"),
]


class KioskCreate(BaseModel):
    """Admin payload to register a new tablet."""

    name: str = Field(min_length=1, max_length=200)
    branch_id: UUID
    slug: SlugStr | None = None  # auto-generated from name if absent
    password: str = Field(min_length=4, max_length=128)
    notes: str | None = Field(default=None, max_length=500)


class KioskUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    branch_id: UUID | None = None
    slug: SlugStr | None = None
    notes: str | None = Field(default=None, max_length=500)
    is_active: bool | None = None


class KioskResetPassword(BaseModel):
    password: str = Field(min_length=4, max_length=128)


class KioskRead(ORMBase):
    id: UUID
    company_id: UUID
    branch_id: UUID
    name: str
    slug: str
    notes: str | None
    is_active: bool
    last_seen_at: datetime | None
    created_at: datetime
    updated_at: datetime


class KioskCreateResponse(BaseModel):
    """Returned once on create — contains the kiosk row plus the public
    URL the operator hands to the tablet. Password is echoed back so the
    operator can copy it before navigating away (it's hashed in DB)."""

    kiosk: KioskRead
    login_url: str
    password: str


class KioskLoginRequest(BaseModel):
    slug: SlugStr
    password: str = Field(min_length=1, max_length=128)


class KioskLoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    kiosk: KioskRead


# ---------- Runtime (tablet) schemas -----------------------------------------


class KioskBranchInfo(BaseModel):
    id: UUID
    name: str
    address: str | None = None


class KioskCompanyInfo(BaseModel):
    id: UUID
    name: str
    logo_url: str | None = None
    settings: dict | None = None


class KioskMeResponse(BaseModel):
    """What the tablet pulls on boot to render its shell."""

    kiosk: KioskRead
    branch: KioskBranchInfo
    company: KioskCompanyInfo


class KioskEmployee(BaseModel):
    id: UUID
    employee_code: str | None = None
    full_name: str
    photo_url: str | None = None
    department_name: str | None = None
    position: str | None = None
    is_currently_in: bool = False


class KioskEmployeeList(BaseModel):
    items: list[KioskEmployee]
    total: int


class KioskAttendanceRequest(BaseModel):
    """Tablet → server when an employee is identified (manual selection
    today; face match in Phase 4 swaps the identifier)."""

    employee_id: UUID
    image_base64: str | None = Field(default=None, max_length=10_000_000)
    notes: str | None = Field(default=None, max_length=500)


class KioskAttendanceResponse(BaseModel):
    """Compact response the tablet renders on the success overlay."""

    employee: KioskEmployee
    check_type: str  # "CHECK_IN" | "CHECK_OUT"
    timestamp: datetime
    is_late: bool = False
    late_minutes: int = 0
    overtime_minutes: int = 0


class KioskRecognizeRequest(BaseModel):
    """Phase 4: client uploads a captured frame and the server resolves it
    to an employee. Phase 3 ships the route as a stub so the client can
    wire up against a stable contract."""

    image_base64: str = Field(min_length=10, max_length=10_000_000)


class KioskRecognizeMatch(BaseModel):
    employee: KioskEmployee
    score: float = 0.0


class KioskRecognizeResponse(BaseModel):
    matched: bool
    match: KioskRecognizeMatch | None = None
    reason: str | None = None  # e.g. "no_face_detected", "low_confidence"
