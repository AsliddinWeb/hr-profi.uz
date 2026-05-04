"""Subscription plans — read-only catalog for the pricing/tariffs page."""
from __future__ import annotations

from fastapi import APIRouter

from app.core.plans import PLAN_FEATURES, PLAN_LIMITS, PLAN_PRICE_UZS
from app.models.company import CompanyPlan
from app.schemas.plan import PlanInfo

router = APIRouter(prefix="/plans", tags=["plans"])


@router.get("", response_model=list[PlanInfo])
async def list_plans() -> list[PlanInfo]:
    """All plans with limits + features, ordered cheap→pricey."""
    order = [CompanyPlan.FREE, CompanyPlan.PRO, CompanyPlan.ENTERPRISE]
    return [
        PlanInfo(
            plan=p,
            price_uzs=PLAN_PRICE_UZS.get(p, 0),
            limits={k: v for k, v in PLAN_LIMITS.get(p, {}).items()},
            features={k: v for k, v in PLAN_FEATURES.get(p, {}).items()},
        )
        for p in order
    ]
