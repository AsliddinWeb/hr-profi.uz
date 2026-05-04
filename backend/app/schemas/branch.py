"""Branch schemas."""
from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.common import ORMBase


class BranchCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    address: str | None = Field(default=None, max_length=500)
    photo_url: str | None = Field(default=None, max_length=500)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    geofence_radius_m: int = Field(default=150, ge=10, le=5000)
    manager_id: UUID | None = None
    working_hours: dict[str, Any] | None = None


class BranchUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    address: str | None = Field(default=None, max_length=500)
    photo_url: str | None = Field(default=None, max_length=500)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    geofence_radius_m: int | None = Field(default=None, ge=10, le=5000)
    manager_id: UUID | None = None
    working_hours: dict[str, Any] | None = None
    is_active: bool | None = None


class BranchRead(ORMBase):
    id: UUID
    company_id: UUID
    name: str
    address: str | None
    photo_url: str | None
    latitude: float | None
    longitude: float | None
    geofence_radius_m: int
    manager_id: UUID | None
    working_hours: dict[str, Any] | None
    is_active: bool
    created_at: datetime
    updated_at: datetime


__all__ = ["BranchCreate", "BranchRead", "BranchUpdate"]
