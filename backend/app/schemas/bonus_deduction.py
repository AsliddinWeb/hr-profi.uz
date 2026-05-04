"""Bonus + Deduction schemas."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.bonus_deduction import BonusType, DeductionType
from app.schemas.common import ORMBase


class BonusCreate(BaseModel):
    employee_id: UUID
    type: BonusType = BonusType.FIXED
    amount: Decimal = Field(gt=0)
    reason: str | None = Field(default=None, max_length=500)
    applied_date: date


class BonusRead(ORMBase):
    id: UUID
    company_id: UUID
    employee_id: UUID
    period_id: UUID | None
    type: BonusType
    amount: Decimal
    reason: str | None
    given_by: UUID | None
    applied_date: date
    applied_at: datetime
    auto_generated: bool
    created_at: datetime


class DeductionCreate(BaseModel):
    employee_id: UUID
    type: DeductionType = DeductionType.PENALTY
    amount: Decimal = Field(gt=0)
    reason: str | None = Field(default=None, max_length=500)
    applied_date: date


class DeductionRead(ORMBase):
    id: UUID
    company_id: UUID
    employee_id: UUID
    period_id: UUID | None
    type: DeductionType
    amount: Decimal
    reason: str | None
    applied_by: UUID | None
    applied_date: date
    applied_at: datetime
    auto_generated: bool
    created_at: datetime


__all__ = [
    "BonusCreate",
    "BonusRead",
    "DeductionCreate",
    "DeductionRead",
]
