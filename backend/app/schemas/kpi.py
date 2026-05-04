"""KPI Pydantic v2 schemas — production rebuild.

Separation:
- ``*Create`` for input on POST.
- ``*Update`` for partial PATCH (every field optional).
- ``*Read``  for response payloads (returns Decimal as plain numerics).
- helper schemas for approve/reject/bulk and dashboard responses.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.models.kpi import (
    KPIAssignmentStatus,
    KPIAuditEvent,
    KPICategory,
    KPIPeriodKind,
    MetricSource,
    RewardType,
)
from app.schemas.common import ORMBase


# ---------- Templates -------------------------------------------------------


class KPITierBracket(BaseModel):
    """One bracket of a TIERED reward. Score ∈ [from_pct, to_pct) → reward
    multiplier × ``reward_amount``."""

    from_pct: Decimal = Field(ge=0)
    to_pct: Decimal = Field(ge=0)
    multiplier: Decimal = Field(ge=0)


class KPITemplateCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=1000)
    category: KPICategory = KPICategory.CUSTOM
    metric_source: MetricSource = MetricSource.AUTO
    formula: str = Field(min_length=1, max_length=1000)
    target_value: Decimal = Field(default=Decimal("100"), ge=0)
    unit: str | None = Field(default=None, max_length=32)
    weight: Decimal = Field(default=Decimal("1"), ge=0, le=100)

    period_kind: KPIPeriodKind = KPIPeriodKind.MONTHLY
    min_threshold_pct: Decimal = Field(default=Decimal("0"), ge=0, le=200)
    max_score_cap_pct: Decimal | None = Field(default=None, ge=0, le=1000)

    reward_type: RewardType = RewardType.FIXED
    reward_amount: Decimal = Field(default=Decimal("0"), ge=0)
    tiers: list[KPITierBracket] | None = None

    requires_manager_review: bool = False

    @field_validator("tiers")
    @classmethod
    def _validate_tiers(
        cls, v: list[KPITierBracket] | None
    ) -> list[KPITierBracket] | None:
        if not v:
            return v
        # Brackets must be non-overlapping and ordered by from_pct.
        s = sorted(v, key=lambda t: t.from_pct)
        for i, t in enumerate(s):
            if t.from_pct >= t.to_pct:
                raise ValueError("tier from_pct must be < to_pct")
            if i > 0 and t.from_pct < s[i - 1].to_pct:
                raise ValueError("tiers must not overlap")
        return s


class KPITemplateUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=1000)
    category: KPICategory | None = None
    metric_source: MetricSource | None = None
    formula: str | None = Field(default=None, min_length=1, max_length=1000)
    target_value: Decimal | None = Field(default=None, ge=0)
    unit: str | None = Field(default=None, max_length=32)
    weight: Decimal | None = Field(default=None, ge=0, le=100)
    period_kind: KPIPeriodKind | None = None
    min_threshold_pct: Decimal | None = Field(default=None, ge=0, le=200)
    max_score_cap_pct: Decimal | None = Field(default=None, ge=0, le=1000)
    reward_type: RewardType | None = None
    reward_amount: Decimal | None = Field(default=None, ge=0)
    tiers: list[KPITierBracket] | None = None
    requires_manager_review: bool | None = None
    is_active: bool | None = None


class KPITemplateRead(ORMBase):
    id: UUID
    company_id: UUID
    name: str
    description: str | None
    category: KPICategory
    metric_source: MetricSource
    formula: str
    target_value: Decimal
    unit: str | None
    weight: Decimal
    period_kind: KPIPeriodKind
    min_threshold_pct: Decimal
    max_score_cap_pct: Decimal | None
    reward_type: RewardType
    reward_amount: Decimal
    tiers_json: list[dict[str, Any]] | None = Field(default=None, alias="tiers")
    requires_manager_review: bool
    is_active: bool
    created_at: datetime
    updated_at: datetime


# ---------- Assignments -----------------------------------------------------


class KPIAssignmentCreate(BaseModel):
    employee_id: UUID
    kpi_template_id: UUID
    year: int = Field(ge=2020, le=2099)
    month: int = Field(ge=1, le=12)
    target: Decimal = Field(default=Decimal("0"), ge=0)
    notes: str | None = Field(default=None, max_length=2000)


class KPIAssignmentUpdate(BaseModel):
    target: Decimal | None = Field(default=None, ge=0)
    actual: Decimal | None = Field(default=None, ge=0)
    manager_rating: Decimal | None = Field(default=None, ge=1, le=5)
    manager_comment: str | None = Field(default=None, max_length=4000)
    employee_response: str | None = Field(default=None, max_length=4000)
    notes: str | None = Field(default=None, max_length=2000)
    status: KPIAssignmentStatus | None = None


class KPIAssignmentApprove(BaseModel):
    """Used by HR / branch manager to finalize a COMPUTED assignment.

    ``manager_rating``/``manager_comment`` are optional but encouraged when the
    template has ``requires_manager_review=True``. After approval the salary
    bridge writes a Bonus (or Deduction for penalty templates).
    """

    manager_rating: Decimal | None = Field(default=None, ge=1, le=5)
    manager_comment: str | None = Field(default=None, max_length=4000)
    override_reward: Decimal | None = Field(default=None, ge=0)


class KPIAssignmentReject(BaseModel):
    reason: str = Field(min_length=1, max_length=4000)


class KPIAssignmentRead(ORMBase):
    id: UUID
    company_id: UUID
    employee_id: UUID
    kpi_template_id: UUID
    year: int
    month: int
    target: Decimal
    actual: Decimal
    score: Decimal
    weight_at_assignment: Decimal
    computed_reward: Decimal
    is_penalty: bool
    status: KPIAssignmentStatus
    inputs_snapshot: dict | None
    last_computed_at: datetime | None
    last_compute_error: str | None
    manager_rating: Decimal | None
    manager_comment: str | None
    employee_response: str | None
    approved_by: UUID | None
    approved_at: datetime | None
    paid_via_bonus_id: UUID | None
    paid_via_deduction_id: UUID | None
    notes: str | None
    created_at: datetime
    updated_at: datetime


class KPIAssignmentDetail(KPIAssignmentRead):
    """Augmented for the detail page — includes denormalized template +
    employee fields so a single GET feeds the whole page."""

    template_name: str | None = None
    template_unit: str | None = None
    template_category: KPICategory | None = None
    template_period_kind: KPIPeriodKind | None = None
    template_reward_type: RewardType | None = None
    template_target_value: Decimal | None = None
    employee_name: str | None = None
    employee_code: str | None = None
    employee_branch_id: UUID | None = None
    employee_department_id: UUID | None = None


# ---------- Bulk operations -------------------------------------------------


class KPIBulkAssignRequest(BaseModel):
    """Assign one template to many employees in a single transaction."""

    kpi_template_id: UUID
    year: int = Field(ge=2020, le=2099)
    month: int = Field(ge=1, le=12)
    target: Decimal = Field(default=Decimal("0"), ge=0)
    employee_ids: list[UUID] | None = None
    branch_ids: list[UUID] | None = None
    department_ids: list[UUID] | None = None
    # When True, skip employees already having this template for this period.
    skip_existing: bool = True


class KPIBulkAssignResult(BaseModel):
    created: int
    skipped: int
    failed: int
    failures: list[str] = Field(default_factory=list)


class KPIRecomputeRequest(BaseModel):
    year: int = Field(ge=2020, le=2099)
    month: int = Field(ge=1, le=12)
    employee_ids: list[UUID] | None = None
    template_ids: list[UUID] | None = None


class KPIRecomputeResult(BaseModel):
    recomputed: int
    failed: int
    failures: list[str] = Field(default_factory=list)


# ---------- Data points -----------------------------------------------------


class KPIDataPointCreate(BaseModel):
    employee_id: UUID
    metric_key: str = Field(min_length=1, max_length=100)
    value: Decimal
    recorded_at: datetime
    source: str | None = Field(default=None, max_length=64)
    note: str | None = Field(default=None, max_length=500)


class KPIDataPointBulkCreate(BaseModel):
    items: list[KPIDataPointCreate]


class KPIDataPointRead(ORMBase):
    id: UUID
    company_id: UUID
    employee_id: UUID
    metric_key: str
    value: Decimal
    recorded_at: datetime
    recorded_date: date | None
    source: str | None
    note: str | None
    submitted_by: UUID | None
    is_void: bool
    created_at: datetime


# ---------- Leaderboard / dashboard ----------------------------------------


class KPILeaderboardEntry(BaseModel):
    employee_id: UUID
    employee_name: str
    employee_code: str | None
    branch_id: UUID | None
    department_id: UUID | None
    total_score: Decimal
    weighted_score: Decimal
    total_reward: Decimal
    total_penalty: Decimal
    assignments_count: int
    approved_count: int
    rank: int


class KPIDashboardSummary(BaseModel):
    """Top-level numbers for the company hub page."""

    year: int
    month: int
    employees_with_kpis: int
    total_assignments: int
    avg_score: Decimal
    total_reward: Decimal
    total_penalty: Decimal
    by_status: dict[str, int]
    by_category: dict[str, int]


class KPIBranchBreakdown(BaseModel):
    branch_id: UUID | None
    branch_name: str | None
    employees: int
    avg_score: Decimal
    total_reward: Decimal


class KPIScoreTrendPoint(BaseModel):
    year: int
    month: int
    avg_score: Decimal
    total_reward: Decimal
    assignments: int


# ---------- Audit -----------------------------------------------------------


class KPIAuditLogRead(ORMBase):
    id: UUID
    assignment_id: UUID | None
    template_id: UUID | None
    event: KPIAuditEvent
    actor_id: UUID | None
    payload: dict | None
    created_at: datetime


# ---------- Vars catalog (for frontend formula builder) --------------------


class KPIVariable(BaseModel):
    """Documented variable that can appear in a formula."""

    name: str
    description: str
    source: str  # "attendance", "leaves", "shifts", "salary", "manual", …
    unit: str | None = None


__all__ = [
    "KPIAssignmentApprove",
    "KPIAssignmentCreate",
    "KPIAssignmentDetail",
    "KPIAssignmentRead",
    "KPIAssignmentReject",
    "KPIAssignmentUpdate",
    "KPIAuditLogRead",
    "KPIBranchBreakdown",
    "KPIBulkAssignRequest",
    "KPIBulkAssignResult",
    "KPIDashboardSummary",
    "KPIDataPointBulkCreate",
    "KPIDataPointCreate",
    "KPIDataPointRead",
    "KPILeaderboardEntry",
    "KPIRecomputeRequest",
    "KPIRecomputeResult",
    "KPIScoreTrendPoint",
    "KPITemplateCreate",
    "KPITemplateRead",
    "KPITemplateUpdate",
    "KPITierBracket",
    "KPIVariable",
]
