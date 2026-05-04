"""Department schemas."""
from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.common import ORMBase


class DepartmentCreate(BaseModel):
    branch_id: UUID
    parent_id: UUID | None = None
    name: str = Field(min_length=1, max_length=200)
    code: str | None = Field(default=None, max_length=64)
    description: str | None = Field(default=None, max_length=500)


class DepartmentUpdate(BaseModel):
    parent_id: UUID | None = None
    name: str | None = Field(default=None, max_length=200)
    code: str | None = Field(default=None, max_length=64)
    description: str | None = Field(default=None, max_length=500)
    is_active: bool | None = None


class DepartmentRead(ORMBase):
    id: UUID
    company_id: UUID
    branch_id: UUID
    parent_id: UUID | None
    name: str
    code: str | None
    description: str | None
    is_active: bool
    created_at: datetime
    updated_at: datetime


__all__ = ["DepartmentCreate", "DepartmentRead", "DepartmentUpdate"]
