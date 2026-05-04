"""Subscription plans — feature catalog + limits.

The matrix is shipped as constants (not stored in DB) so it can change with a
deploy. The frontend pulls it via ``GET /plans`` to render the pricing page.

Plan changes are *manual* — the OWNER patches ``Company.plan`` and
``subscription_until`` directly. There is no payment integration (per
CLAUDE.md hard rule #3: no payment provider).
"""
from __future__ import annotations

from app.models.company import CompanyPlan


# Each plan's hard limits. ``None`` means unlimited.
PLAN_LIMITS: dict[CompanyPlan, dict[str, int | None]] = {
    CompanyPlan.FREE: {
        "branches": 1,
        "employees": 10,
        "devices": 0,
        "kpi_templates": 0,
        "salary_module": 0,  # 0 = disabled, 1 = enabled
        "audit_retention_days": 30,
        "api_rate_per_min": 60,
    },
    CompanyPlan.PRO: {
        "branches": 5,
        "employees": 100,
        "devices": 10,
        "kpi_templates": 50,
        "salary_module": 1,
        "audit_retention_days": 365,
        "api_rate_per_min": 300,
    },
    CompanyPlan.ENTERPRISE: {
        "branches": None,
        "employees": None,
        "devices": None,
        "kpi_templates": None,
        "salary_module": 1,
        "audit_retention_days": None,
        "api_rate_per_min": 1000,
    },
}

# Feature flags — boolean per plan. The frontend uses these to render the
# pricing matrix (✓/×) and the backend can call ``has_feature()`` to gate
# specific endpoints when we wire enforcement later.
PLAN_FEATURES: dict[CompanyPlan, dict[str, bool]] = {
    CompanyPlan.FREE: {
        "attendance_basic": True,
        "attendance_face_id": False,
        "attendance_geofence": False,
        "shifts": True,
        "leaves": True,
        "salary": False,
        "kpi": False,
        "bonuses_deductions": False,
        "monthly_reports": False,
        "csv_export": True,
        "audit_log": False,
        "api_access": False,
        "white_label": False,
        "priority_support": False,
        "telegram_notifications": False,
    },
    CompanyPlan.PRO: {
        "attendance_basic": True,
        "attendance_face_id": True,
        "attendance_geofence": True,
        "shifts": True,
        "leaves": True,
        "salary": True,
        "kpi": True,
        "bonuses_deductions": True,
        "monthly_reports": True,
        "csv_export": True,
        "audit_log": True,
        "api_access": True,
        "white_label": False,
        "priority_support": False,
        "telegram_notifications": True,
    },
    CompanyPlan.ENTERPRISE: {
        "attendance_basic": True,
        "attendance_face_id": True,
        "attendance_geofence": True,
        "shifts": True,
        "leaves": True,
        "salary": True,
        "kpi": True,
        "bonuses_deductions": True,
        "monthly_reports": True,
        "csv_export": True,
        "audit_log": True,
        "api_access": True,
        "white_label": True,
        "priority_support": True,
        "telegram_notifications": True,
    },
}

# Suggested monthly price in UZS — just for display, no payment processed.
PLAN_PRICE_UZS: dict[CompanyPlan, int] = {
    CompanyPlan.FREE: 0,
    CompanyPlan.PRO: 990_000,
    CompanyPlan.ENTERPRISE: 0,  # contact us
}


def has_feature(plan: CompanyPlan | str, key: str) -> bool:
    """Helper to gate endpoints: ``if not has_feature(company.plan, "kpi"): raise``"""
    p = CompanyPlan(plan) if isinstance(plan, str) else plan
    return PLAN_FEATURES.get(p, {}).get(key, False)


def limit(plan: CompanyPlan | str, key: str) -> int | None:
    """Returns the hard limit (or None for unlimited)."""
    p = CompanyPlan(plan) if isinstance(plan, str) else plan
    return PLAN_LIMITS.get(p, {}).get(key)


__all__ = [
    "PLAN_FEATURES",
    "PLAN_LIMITS",
    "PLAN_PRICE_UZS",
    "has_feature",
    "limit",
]
