"""KPI engine — production-grade.

Three core entities:

* ``KPITemplate``     — a metric definition (formula + reward rule).
* ``KPIAssignment``   — a template applied to one employee for a period.
                        Carries the input snapshot, score, reward, status
                        workflow (DRAFT → ACTIVE → COMPUTED → APPROVED →
                        PAID/REJECTED) and approval metadata.
* ``KPIDataPoint``    — manual/external metric values feeding the formula.
* ``KPIAuditLog``     — append-only history of every state change so HR
                        and managers can answer "why did this score change?"
                        months later.

Formulas are tiny Python expressions evaluated against a locked-down namespace
of provider variables (attendance, leaves, shifts, salary, employee, manual
data points). See ``services/kpi_service.py``.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TenantMixin, TimestampMixin

if TYPE_CHECKING:
    pass


# ---------- Enums ----------------------------------------------------------


class KPICategory(StrEnum):
    ATTENDANCE = "ATTENDANCE"  # auto: late_count, present_days etc.
    SALES = "SALES"  # manual: sold_amount, deals_closed
    TASKS = "TASKS"  # manual: tickets_resolved, projects_done
    QUALITY = "QUALITY"  # manual: defects, customer_satisfaction
    MANAGER_REVIEW = "MANAGER_REVIEW"  # manager_rating-driven
    GOAL = "GOAL"  # qualitative milestone, score = manual %
    CUSTOM = "CUSTOM"  # any formula


class MetricSource(StrEnum):
    AUTO = "AUTO"  # variables from providers (attendance, leave, salary, …)
    MANUAL = "MANUAL"  # variables only from KPIDataPoint
    HYBRID = "HYBRID"  # both


class RewardType(StrEnum):
    FIXED = "FIXED"  # full reward_amount when score >= threshold
    PERCENT_OF_SALARY = "PERCENT_OF_SALARY"
    PER_UNIT = "PER_UNIT"
    TIERED = "TIERED"  # uses tiers_json brackets
    PENALTY_PERCENT = "PENALTY_PERCENT"  # produces a Deduction not a Bonus


class KPIPeriodKind(StrEnum):
    MONTHLY = "MONTHLY"
    QUARTERLY = "QUARTERLY"
    WEEKLY = "WEEKLY"


class KPIAssignmentStatus(StrEnum):
    DRAFT = "DRAFT"  # created, not yet active
    ACTIVE = "ACTIVE"  # within the period, eligible for recompute
    COMPUTED = "COMPUTED"  # score finalized, awaiting approval
    APPROVED = "APPROVED"  # approved by manager / HR
    PAID = "PAID"  # bonus row generated and salary period closed
    REJECTED = "REJECTED"  # rejected during review (no payout)
    CANCELLED = "CANCELLED"  # voided early
    COMPLETED = "COMPLETED"  # legacy alias for PAID — kept for migration


class KPIAuditEvent(StrEnum):
    CREATED = "CREATED"
    UPDATED = "UPDATED"
    RECOMPUTED = "RECOMPUTED"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    PAID = "PAID"
    CANCELLED = "CANCELLED"
    BULK_ASSIGN = "BULK_ASSIGN"
    BULK_RECOMPUTE = "BULK_RECOMPUTE"


# ---------- Tables ---------------------------------------------------------


class KPITemplate(Base, TenantMixin, TimestampMixin):
    __tablename__ = "kpi_templates"
    __table_args__ = (
        UniqueConstraint("company_id", "name", name="uq_kpi_templates_company_name"),
    )

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(String(1000))
    category: Mapped[KPICategory] = mapped_column(
        String(24), default=KPICategory.CUSTOM.value, nullable=False
    )
    metric_source: Mapped[MetricSource] = mapped_column(
        String(8), default=MetricSource.AUTO.value, nullable=False
    )
    formula: Mapped[str] = mapped_column(String(1000), nullable=False)

    target_value: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=100, nullable=False)
    unit: Mapped[str | None] = mapped_column(String(32))
    weight: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=1, nullable=False)

    period_kind: Mapped[KPIPeriodKind] = mapped_column(
        String(16), default=KPIPeriodKind.MONTHLY.value, nullable=False
    )
    # Score < min_threshold_pct → reward 0. Score >= min_threshold_pct →
    # normal reward calc. Helps avoid paying for noise on near-zero scores.
    min_threshold_pct: Mapped[Decimal] = mapped_column(
        Numeric(6, 2), default=0, nullable=False
    )
    # Score is clamped to this when computing reward (e.g. 200 caps at 2x).
    max_score_cap_pct: Mapped[Decimal | None] = mapped_column(Numeric(6, 2))

    reward_type: Mapped[RewardType] = mapped_column(
        String(20), default=RewardType.FIXED.value, nullable=False
    )
    reward_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    # For TIERED rewards. Shape: [{"from_pct": 0, "to_pct": 60, "multiplier": 0},
    # {"from_pct": 60, "to_pct": 80, "multiplier": 0.5}, ...].
    tiers_json: Mapped[list | None] = mapped_column(JSONB)

    requires_manager_review: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class KPIAssignment(Base, TenantMixin, TimestampMixin):
    __tablename__ = "kpi_assignments"
    __table_args__ = (
        UniqueConstraint(
            "employee_id",
            "kpi_template_id",
            "year",
            "month",
            name="uq_kpi_assignments_emp_tpl_year_month",
        ),
    )

    employee_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("employees.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    kpi_template_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("kpi_templates.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    year: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    month: Mapped[int] = mapped_column(Integer, nullable=False, index=True)

    target: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    actual: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    score: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=0, nullable=False)
    weight_at_assignment: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), default=1, nullable=False
    )

    computed_reward: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    # Negative for PENALTY_PERCENT rewards — when set, salary_bridge writes
    # a Deduction instead of a Bonus.
    is_penalty: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    status: Mapped[KPIAssignmentStatus] = mapped_column(
        String(16), default=KPIAssignmentStatus.ACTIVE.value, nullable=False, index=True
    )
    # Snapshot of provider variables + final formula at compute time. Lets
    # admins answer "where did this score come from?" months later.
    inputs_snapshot: Mapped[dict | None] = mapped_column(JSONB)
    last_computed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_compute_error: Mapped[str | None] = mapped_column(String(500))

    # Manager review / approval workflow
    manager_rating: Mapped[Decimal | None] = mapped_column(Numeric(3, 2))  # 1.00 — 5.00
    manager_comment: Mapped[str | None] = mapped_column(Text)
    employee_response: Mapped[str | None] = mapped_column(Text)
    approved_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Link to the salary integration. When status becomes APPROVED the bridge
    # creates a Bonus (or Deduction for is_penalty=True) and stamps its id here.
    paid_via_bonus_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("bonuses.id", ondelete="SET NULL")
    )
    paid_via_deduction_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("deductions.id", ondelete="SET NULL")
    )

    notes: Mapped[str | None] = mapped_column(Text)


class KPIDataPoint(Base, TenantMixin, TimestampMixin):
    """Manual/external metric input.

    Multiple data points with the same metric_key in one period are summed by
    the formula engine — this lets you push raw events (e.g. each closed deal
    as a row of value 1) instead of pre-aggregating.
    """

    __tablename__ = "kpi_data_points"

    employee_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("employees.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    metric_key: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    value: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    recorded_date: Mapped[date | None] = mapped_column(Date, index=True)
    source: Mapped[str | None] = mapped_column(String(64))
    note: Mapped[str | None] = mapped_column(String(500))
    submitted_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    # Soft-delete instead of hard delete so recompute history stays explainable.
    is_void: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class KPIAuditLog(Base, TenantMixin, TimestampMixin):
    """Append-only history of every assignment / template state change."""

    __tablename__ = "kpi_audit_logs"

    assignment_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("kpi_assignments.id", ondelete="CASCADE"),
        index=True,
    )
    template_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("kpi_templates.id", ondelete="CASCADE"),
        index=True,
    )
    event: Mapped[KPIAuditEvent] = mapped_column(String(24), nullable=False, index=True)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    # Free-form payload: prev/next status, vars used in recompute, message, etc.
    payload: Mapped[dict | None] = mapped_column(JSONB)


__all__ = [
    "KPIAssignment",
    "KPIAssignmentStatus",
    "KPIAuditEvent",
    "KPIAuditLog",
    "KPICategory",
    "KPIDataPoint",
    "KPIPeriodKind",
    "KPITemplate",
    "MetricSource",
    "RewardType",
]
