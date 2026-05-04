"""Plan schemas — pricing page payload."""
from __future__ import annotations

from pydantic import BaseModel

from app.models.company import CompanyPlan


class PlanInfo(BaseModel):
    plan: CompanyPlan
    price_uzs: int
    limits: dict[str, int | None]
    features: dict[str, bool]


__all__ = ["PlanInfo"]
