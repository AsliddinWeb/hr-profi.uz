"""KPI compute engine — production rebuild.

Architecture:

* **Variable providers** (``_VarProvider``) collect numeric variables from
  one source — attendance, leaves, shifts, salary, employee, manual data
  points, manager review. Each provider is independent and tested in
  isolation.

* **Formula engine** (``_safe_eval``) evaluates a Python expression in a
  locked-down AST namespace. Allowed: arithmetic, ``min/max/abs/round``,
  ternary ``a if cond else b``, comparisons, boolean ops. Forbidden:
  attribute access, dunder calls, imports, function definitions.

* **Reward calculator** (``_compute_reward``) applies the template's
  ``reward_type``: FIXED / PERCENT_OF_SALARY / PER_UNIT / TIERED /
  PENALTY_PERCENT.

* **Salary bridge** (``settle_assignment``) — when an assignment moves to
  APPROVED, write a Bonus (or Deduction for penalties) tagged with the
  assignment id, then move to PAID.

* **Audit** — every recompute / approve / reject / pay writes a
  ``KPIAuditLog`` row.

The engine is idempotent: recomputing or approving the same assignment
multiple times keeps the salary side in sync (no duplicate bonuses).
"""
from __future__ import annotations

import ast
import logging
from datetime import date as Date
from datetime import datetime, time, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.attendance import (
    AttendanceRecord,
    AttendanceStatus,
    CheckType,
)
from app.models.bonus_deduction import (
    Bonus,
    BonusType,
    Deduction,
    DeductionType,
)
from app.models.employee import Employee
from app.models.kpi import (
    KPIAssignment,
    KPIAssignmentStatus,
    KPIAuditEvent,
    KPIAuditLog,
    KPIDataPoint,
    KPITemplate,
    MetricSource,
    RewardType,
)
from app.models.leave import LeaveRequest, LeaveStatus, LeaveType
from app.models.shift import ScheduleStatus, ShiftSchedule

log = logging.getLogger(__name__)


# ============ Formula engine ===============================================

# Whitelisted AST nodes for formula evaluation.
_ALLOWED_NODES: set[type] = {
    ast.Expression,
    ast.Constant,
    ast.Name,
    ast.Load,
    ast.BinOp,
    ast.UnaryOp,
    ast.UAdd,
    ast.USub,
    ast.Not,
    ast.Add,
    ast.Sub,
    ast.Mult,
    ast.Div,
    ast.FloorDiv,
    ast.Mod,
    ast.Pow,
    ast.Compare,
    ast.Eq,
    ast.NotEq,
    ast.Lt,
    ast.LtE,
    ast.Gt,
    ast.GtE,
    ast.IfExp,
    ast.BoolOp,
    ast.And,
    ast.Or,
    ast.Call,
}
_ALLOWED_FUNCS = {
    "min": min,
    "max": max,
    "abs": abs,
    "round": round,
    # Convenience helpers exposed to formulas.
    "iif": lambda c, a, b: a if c else b,
    "clamp": lambda x, lo, hi: max(lo, min(hi, x)),
}


class FormulaError(ValueError):
    """Raised when a formula references unknown vars or forbidden constructs."""


def _safe_eval(formula: str, variables: dict[str, float]) -> float:
    try:
        tree = ast.parse(formula, mode="eval")
    except SyntaxError as e:
        raise FormulaError(f"syntax error: {e}") from e

    for node in ast.walk(tree):
        if type(node) not in _ALLOWED_NODES:
            raise FormulaError(f"forbidden construct: {type(node).__name__}")
        if isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name) or node.func.id not in _ALLOWED_FUNCS:
                raise FormulaError("only min/max/abs/round/iif/clamp allowed")
        if isinstance(node, ast.Name) and node.id not in {*variables, *_ALLOWED_FUNCS}:
            raise FormulaError(f"unknown variable: {node.id}")

    code = compile(tree, "<formula>", "eval")
    return float(eval(code, {"__builtins__": {}}, {**_ALLOWED_FUNCS, **variables}))  # noqa: S307


# Variables that the engine guarantees to populate for AUTO/HYBRID templates.
# Surfaced to the frontend via the /kpi/variables endpoint so the formula
# builder can offer autocomplete with descriptions.
KPI_VARIABLE_CATALOG: list[dict[str, Any]] = [
    # attendance
    {"name": "present_days", "source": "attendance", "unit": "days",
     "description": "Distinct dates with a non-rejected check-in."},
    {"name": "work_days", "source": "shifts", "unit": "days",
     "description": "Scheduled work days for the period (excl. rest days)."},
    {"name": "absence_days", "source": "attendance", "unit": "days",
     "description": "Scheduled days with no check-in."},
    {"name": "late_count", "source": "attendance", "unit": "events",
     "description": "Number of late check-ins."},
    {"name": "late_minutes_total", "source": "attendance", "unit": "minutes",
     "description": "Sum of all late minutes."},
    {"name": "overtime_hours_total", "source": "attendance", "unit": "hours",
     "description": "Sum of overtime minutes / 60."},
    {"name": "early_leave_count", "source": "attendance", "unit": "events",
     "description": "Number of early-leave check-outs."},
    # leaves
    {"name": "leave_days", "source": "leaves", "unit": "days",
     "description": "Approved leave days overlapping the period."},
    {"name": "paid_leave_days", "source": "leaves", "unit": "days",
     "description": "Approved paid leave days."},
    {"name": "unpaid_leave_days", "source": "leaves", "unit": "days",
     "description": "Approved unpaid leave days."},
    # employee
    {"name": "base_salary", "source": "employee", "unit": "currency",
     "description": "Employee.base_salary at compute time."},
    {"name": "tenure_years", "source": "employee", "unit": "years",
     "description": "Years since hire_date (0 if no hire_date)."},
    # manager review
    {"name": "manager_rating", "source": "review", "unit": "1-5",
     "description": "Manager's 1-5 rating, 0 if not yet rated."},
    # target and weight (passed through from template / assignment)
    {"name": "target", "source": "self", "description": "Assignment target."},
    {"name": "weight", "source": "self", "description": "Template weight."},
]


# ============ Variable providers ===========================================


def _period_bounds(year: int, month: int) -> tuple[Date, Date]:
    start = Date(year, month, 1)
    end = (
        Date(year + (month // 12), (month % 12) + 1, 1)
        if month < 12
        else Date(year + 1, 1, 1)
    )
    return start, end


async def _attendance_vars(
    db: AsyncSession, employee_id: UUID, year: int, month: int
) -> dict[str, float]:
    period_start, period_end = _period_bounds(year, month)
    start_dt = datetime.combine(period_start, time.min, tzinfo=timezone.utc)
    end_dt = datetime.combine(period_end, time.min, tzinfo=timezone.utc)

    present_days = (
        await db.execute(
            select(func.count(func.distinct(func.date(AttendanceRecord.timestamp))))
            .where(
                AttendanceRecord.employee_id == employee_id,
                AttendanceRecord.check_type == CheckType.CHECK_IN,
                AttendanceRecord.status != AttendanceStatus.REJECTED,
                AttendanceRecord.timestamp >= start_dt,
                AttendanceRecord.timestamp < end_dt,
            )
        )
    ).scalar_one()

    late_count = (
        await db.execute(
            select(func.count(AttendanceRecord.id)).where(
                AttendanceRecord.employee_id == employee_id,
                AttendanceRecord.check_type == CheckType.CHECK_IN,
                AttendanceRecord.is_late.is_(True),
                AttendanceRecord.timestamp >= start_dt,
                AttendanceRecord.timestamp < end_dt,
            )
        )
    ).scalar_one()

    late_minutes_total = (
        await db.execute(
            select(func.coalesce(func.sum(AttendanceRecord.late_minutes), 0)).where(
                AttendanceRecord.employee_id == employee_id,
                AttendanceRecord.timestamp >= start_dt,
                AttendanceRecord.timestamp < end_dt,
            )
        )
    ).scalar_one()

    overtime_minutes_total = (
        await db.execute(
            select(func.coalesce(func.sum(AttendanceRecord.overtime_minutes), 0)).where(
                AttendanceRecord.employee_id == employee_id,
                AttendanceRecord.timestamp >= start_dt,
                AttendanceRecord.timestamp < end_dt,
            )
        )
    ).scalar_one()

    early_leave_count = (
        await db.execute(
            select(func.count(AttendanceRecord.id)).where(
                AttendanceRecord.employee_id == employee_id,
                AttendanceRecord.check_type == CheckType.CHECK_OUT,
                AttendanceRecord.is_early_leave.is_(True),
                AttendanceRecord.timestamp >= start_dt,
                AttendanceRecord.timestamp < end_dt,
            )
        )
    ).scalar_one()

    return {
        "present_days": float(present_days),
        "late_count": float(late_count),
        "late_minutes_total": float(late_minutes_total),
        "overtime_hours_total": float(overtime_minutes_total) / 60.0,
        "early_leave_count": float(early_leave_count),
    }


async def _shift_vars(
    db: AsyncSession, employee_id: UUID, year: int, month: int
) -> dict[str, float]:
    period_start, period_end = _period_bounds(year, month)
    work_days = (
        await db.execute(
            select(func.count(ShiftSchedule.id)).where(
                ShiftSchedule.employee_id == employee_id,
                ShiftSchedule.date >= period_start,
                ShiftSchedule.date < period_end,
                ShiftSchedule.status != ScheduleStatus.REST_DAY,
                ShiftSchedule.status != ScheduleStatus.CANCELLED,
            )
        )
    ).scalar_one()
    # If no schedule exists, fall back to calendar days as a safe default
    # (matches legacy behaviour).
    if work_days == 0:
        work_days = (period_end - period_start).days
    return {"work_days": float(work_days)}


async def _attendance_with_shifts(
    db: AsyncSession, employee_id: UUID, year: int, month: int
) -> dict[str, float]:
    """Compute absence_days = scheduled_days - present_days. Done after
    both attendance + shifts are collected."""
    a = await _attendance_vars(db, employee_id, year, month)
    s = await _shift_vars(db, employee_id, year, month)
    absence = max(0.0, s["work_days"] - a["present_days"])
    return {**a, **s, "absence_days": absence}


async def _leave_vars(
    db: AsyncSession, employee_id: UUID, year: int, month: int
) -> dict[str, float]:
    period_start, period_end = _period_bounds(year, month)
    rows = (
        await db.execute(
            select(LeaveRequest, LeaveType.paid)
            .join(LeaveType, LeaveType.id == LeaveRequest.leave_type_id)
            .where(
                LeaveRequest.employee_id == employee_id,
                LeaveRequest.status == LeaveStatus.APPROVED,
                LeaveRequest.start_date < period_end,
                LeaveRequest.end_date >= period_start,
            )
        )
    ).all()
    total = paid = unpaid = 0.0
    for lr, is_paid in rows:
        # Days that fall inside the period.
        s = max(lr.start_date, period_start)
        e = min(lr.end_date, period_end - timedelta(days=1))
        days = max(0, (e - s).days + 1)
        total += days
        if is_paid:
            paid += days
        else:
            unpaid += days
    return {
        "leave_days": float(total),
        "paid_leave_days": float(paid),
        "unpaid_leave_days": float(unpaid),
    }


async def _employee_vars(
    db: AsyncSession, employee: Employee, today: Date
) -> dict[str, float]:
    base_salary = float(employee.base_salary or 0)
    tenure = 0.0
    if employee.hire_date:
        delta = today - employee.hire_date
        tenure = delta.days / 365.25
    return {"base_salary": base_salary, "tenure_years": tenure}


async def _manual_vars(
    db: AsyncSession, employee_id: UUID, year: int, month: int
) -> dict[str, float]:
    period_start = datetime(year, month, 1, tzinfo=timezone.utc)
    period_end = (
        datetime(year + (month // 12), (month % 12) + 1, 1, tzinfo=timezone.utc)
        if month < 12
        else datetime(year + 1, 1, 1, tzinfo=timezone.utc)
    )
    rows = (
        await db.execute(
            select(
                KPIDataPoint.metric_key,
                func.coalesce(func.sum(KPIDataPoint.value), 0),
            )
            .where(
                KPIDataPoint.employee_id == employee_id,
                KPIDataPoint.recorded_at >= period_start,
                KPIDataPoint.recorded_at < period_end,
                KPIDataPoint.is_void.is_(False),
            )
            .group_by(KPIDataPoint.metric_key)
        )
    ).all()
    return {key: float(val) for key, val in rows}


async def collect_variables(
    db: AsyncSession,
    employee: Employee,
    template: KPITemplate,
    assignment: KPIAssignment,
) -> dict[str, float]:
    """Compose the final variable namespace for ``template.formula``."""
    variables: dict[str, float] = {
        "target": float(assignment.target or template.target_value or 0),
        "weight": float(assignment.weight_at_assignment or template.weight or 1),
        "manager_rating": float(assignment.manager_rating or 0),
    }
    if template.metric_source in (MetricSource.AUTO, MetricSource.HYBRID):
        variables.update(
            await _attendance_with_shifts(
                db, employee.id, assignment.year, assignment.month
            )
        )
        variables.update(
            await _leave_vars(db, employee.id, assignment.year, assignment.month)
        )
        variables.update(
            await _employee_vars(db, employee, Date(assignment.year, assignment.month, 1))
        )
    if template.metric_source in (MetricSource.MANUAL, MetricSource.HYBRID):
        variables.update(
            await _manual_vars(db, employee.id, assignment.year, assignment.month)
        )
    return variables


# ============ Reward calculator ============================================


def _apply_threshold_and_cap(
    score_pct: Decimal, template: KPITemplate
) -> Decimal:
    if score_pct < template.min_threshold_pct:
        return Decimal(0)
    if template.max_score_cap_pct is not None and score_pct > template.max_score_cap_pct:
        return template.max_score_cap_pct
    return score_pct


def _compute_reward(
    template: KPITemplate, score_pct: Decimal, employee: Employee
) -> tuple[Decimal, bool]:
    """Returns (amount, is_penalty). amount is always non-negative; is_penalty
    flags that a Deduction (not a Bonus) should be created."""
    effective = _apply_threshold_and_cap(score_pct, template)
    base = employee.base_salary or Decimal(0)
    Q = Decimal("0.01")

    if template.reward_type == RewardType.FIXED:
        return (
            template.reward_amount.quantize(Q) if effective >= Decimal(100) else Decimal(0),
            False,
        )

    if template.reward_type == RewardType.PERCENT_OF_SALARY:
        # % of base salary, scaled by score / 100. So at 100% score → full
        # reward_amount % of salary; at 50% → half. Clamped by cap above.
        if effective <= 0:
            return (Decimal(0), False)
        return (
            (base * template.reward_amount * effective / Decimal(10000)).quantize(Q),
            False,
        )

    if template.reward_type == RewardType.PER_UNIT:
        # reward_amount per "unit" achieved. The "actual" is target × score/100.
        actual = (template.target_value or Decimal(0)) * effective / Decimal(100)
        return (
            (template.reward_amount * actual).quantize(Q),
            False,
        )

    if template.reward_type == RewardType.TIERED:
        # tiers_json: [{from_pct, to_pct, multiplier}, ...]. We pick the bracket
        # containing the score (or the highest bracket if score exceeds all).
        tiers = template.tiers_json or []
        if not tiers:
            return (Decimal(0), False)
        try:
            ordered = sorted(tiers, key=lambda t: Decimal(str(t["from_pct"])))
        except (KeyError, InvalidOperation):
            return (Decimal(0), False)
        chosen = ordered[0]
        for t in ordered:
            if Decimal(str(t["from_pct"])) <= effective:
                chosen = t
        multiplier = Decimal(str(chosen.get("multiplier", 0)))
        return (
            (template.reward_amount * multiplier).quantize(Q),
            False,
        )

    if template.reward_type == RewardType.PENALTY_PERCENT:
        # When score is below threshold, deduct a percentage of base salary.
        # ``reward_amount`` is treated as the penalty pct here.
        if effective >= Decimal(100):
            return (Decimal(0), True)
        shortfall = (Decimal(100) - effective) / Decimal(100)
        return (
            (base * template.reward_amount * shortfall / Decimal(100)).quantize(Q),
            True,
        )

    return (Decimal(0), False)


# ============ Audit ========================================================


def _audit(
    db: AsyncSession,
    company_id: UUID,
    *,
    event: KPIAuditEvent,
    actor_id: UUID | None = None,
    assignment_id: UUID | None = None,
    template_id: UUID | None = None,
    payload: dict[str, Any] | None = None,
) -> None:
    db.add(
        KPIAuditLog(
            company_id=company_id,
            event=event.value,
            actor_id=actor_id,
            assignment_id=assignment_id,
            template_id=template_id,
            payload=payload,
        )
    )


# ============ Recompute ====================================================


async def recompute_assignment(
    db: AsyncSession,
    assignment: KPIAssignment,
    actor_id: UUID | None = None,
) -> KPIAssignment:
    """Recalculate score + reward for a single assignment. Idempotent."""
    template = (
        await db.execute(
            select(KPITemplate).where(KPITemplate.id == assignment.kpi_template_id)
        )
    ).scalar_one()
    employee = (
        await db.execute(
            select(Employee)
            .where(Employee.id == assignment.employee_id)
            .execution_options(skip_tenant_filter=True)
        )
    ).scalar_one()

    try:
        variables = await collect_variables(db, employee, template, assignment)
        actual = Decimal(str(_safe_eval(template.formula, variables)))
        target = (
            assignment.target if assignment.target and assignment.target > 0
            else template.target_value
        )
        score = (
            (actual / target * Decimal(100)).quantize(Decimal("0.01"))
            if target and target > 0
            else Decimal(0)
        )
        reward, is_penalty = _compute_reward(template, score, employee)
        assignment.actual = actual
        assignment.score = score
        assignment.computed_reward = reward
        assignment.is_penalty = is_penalty
        assignment.weight_at_assignment = template.weight
        assignment.inputs_snapshot = {
            "vars": {k: round(v, 4) for k, v in variables.items()},
            "formula": template.formula,
            "reward_type": template.reward_type,
            "min_threshold_pct": float(template.min_threshold_pct),
            "max_score_cap_pct": (
                float(template.max_score_cap_pct)
                if template.max_score_cap_pct is not None else None
            ),
        }
        assignment.last_compute_error = None
        # Move from DRAFT/ACTIVE to COMPUTED so the approval workflow sees
        # something to review. Already-approved or paid stays put.
        if assignment.status in (
            KPIAssignmentStatus.DRAFT.value,
            KPIAssignmentStatus.ACTIVE.value,
        ):
            assignment.status = KPIAssignmentStatus.COMPUTED.value
        assignment.last_computed_at = datetime.now(timezone.utc)

        _audit(
            db,
            assignment.company_id,
            event=KPIAuditEvent.RECOMPUTED,
            actor_id=actor_id,
            assignment_id=assignment.id,
            template_id=template.id,
            payload={
                "score": float(score),
                "actual": float(actual),
                "reward": float(reward),
                "is_penalty": is_penalty,
            },
        )
    except FormulaError as e:
        assignment.last_compute_error = f"formula: {e}"
        log.warning(
            "kpi.formula_error template=%s assignment=%s err=%s",
            template.id,
            assignment.id,
            e,
        )
    except Exception as e:  # noqa: BLE001
        assignment.last_compute_error = f"engine: {e}"
        log.exception(
            "kpi.recompute_unexpected_error template=%s assignment=%s",
            template.id,
            assignment.id,
        )

    return assignment


async def recompute_company_assignments(
    db: AsyncSession,
    company_id: UUID,
    year: int,
    month: int,
    actor_id: UUID | None = None,
    template_ids: list[UUID] | None = None,
    employee_ids: list[UUID] | None = None,
) -> dict[str, int]:
    """Recompute every active assignment for the period. Skips PAID."""
    stmt = select(KPIAssignment).where(
        KPIAssignment.company_id == company_id,
        KPIAssignment.year == year,
        KPIAssignment.month == month,
        KPIAssignment.status.notin_(
            [
                KPIAssignmentStatus.PAID.value,
                KPIAssignmentStatus.REJECTED.value,
                KPIAssignmentStatus.CANCELLED.value,
            ]
        ),
    )
    if template_ids:
        stmt = stmt.where(KPIAssignment.kpi_template_id.in_(template_ids))
    if employee_ids:
        stmt = stmt.where(KPIAssignment.employee_id.in_(employee_ids))

    rows = (await db.execute(stmt)).scalars().all()
    ok = failed = 0
    failures: list[str] = []
    for a in rows:
        before = a.score
        await recompute_assignment(db, a, actor_id=actor_id)
        if a.last_compute_error:
            failed += 1
            failures.append(f"{a.id}: {a.last_compute_error}")
        else:
            ok += 1
            log.debug(
                "kpi.recompute id=%s score %s -> %s",
                a.id, before, a.score,
            )
    _audit(
        db,
        company_id,
        event=KPIAuditEvent.BULK_RECOMPUTE,
        actor_id=actor_id,
        payload={"year": year, "month": month, "ok": ok, "failed": failed},
    )
    return {"recomputed": ok, "failed": failed, "failures": failures}


# ============ Salary bridge ================================================


def _last_day_of_period(year: int, month: int) -> Date:
    if month < 12:
        return Date(year, month + 1, 1) - timedelta(days=1)
    return Date(year, 12, 31)


async def _settle_bonus(
    db: AsyncSession,
    assignment: KPIAssignment,
    amount: Decimal,
    actor_id: UUID | None,
    template: KPITemplate,
) -> Bonus | None:
    """Idempotently create the Bonus tied to this assignment. If a Bonus is
    already linked via ``paid_via_bonus_id``, just refresh its amount."""
    if amount <= 0:
        return None

    last_day = _last_day_of_period(assignment.year, assignment.month)
    reason = f"KPI:{template.name}"

    if assignment.paid_via_bonus_id:
        bonus = (
            await db.execute(
                select(Bonus).where(Bonus.id == assignment.paid_via_bonus_id)
            )
        ).scalar_one_or_none()
        if bonus:
            bonus.amount = amount
            bonus.reason = reason
            bonus.applied_date = last_day
            return bonus

    bonus = Bonus(
        company_id=assignment.company_id,
        employee_id=assignment.employee_id,
        type=BonusType.KPI.value,
        amount=amount,
        reason=reason,
        given_by=actor_id,
        applied_date=last_day,
        applied_at=datetime.now(timezone.utc),
        auto_generated=True,
    )
    db.add(bonus)
    await db.flush()
    assignment.paid_via_bonus_id = bonus.id
    return bonus


async def _settle_deduction(
    db: AsyncSession,
    assignment: KPIAssignment,
    amount: Decimal,
    actor_id: UUID | None,
    template: KPITemplate,
) -> Deduction | None:
    if amount <= 0:
        return None
    last_day = _last_day_of_period(assignment.year, assignment.month)
    reason = f"KPI penalty:{template.name}"

    if assignment.paid_via_deduction_id:
        ded = (
            await db.execute(
                select(Deduction).where(Deduction.id == assignment.paid_via_deduction_id)
            )
        ).scalar_one_or_none()
        if ded:
            ded.amount = amount
            ded.reason = reason
            ded.applied_date = last_day
            return ded

    ded = Deduction(
        company_id=assignment.company_id,
        employee_id=assignment.employee_id,
        type=DeductionType.PENALTY.value,
        amount=amount,
        reason=reason,
        applied_by=actor_id,
        applied_date=last_day,
        applied_at=datetime.now(timezone.utc),
        auto_generated=True,
    )
    db.add(ded)
    await db.flush()
    assignment.paid_via_deduction_id = ded.id
    return ded


async def approve_assignment(
    db: AsyncSession,
    assignment: KPIAssignment,
    actor_id: UUID | None,
    *,
    manager_rating: Decimal | None = None,
    manager_comment: str | None = None,
    override_reward: Decimal | None = None,
) -> KPIAssignment:
    """Move an assignment to APPROVED → PAID, writing the salary side."""
    template = (
        await db.execute(
            select(KPITemplate).where(KPITemplate.id == assignment.kpi_template_id)
        )
    ).scalar_one()

    # Apply review fields if the user passed them.
    if manager_rating is not None:
        assignment.manager_rating = manager_rating
    if manager_comment is not None:
        assignment.manager_comment = manager_comment

    # Allow an explicit override of the computed reward (e.g. "actual was
    # higher than the auto-formula captured"). We trust the human.
    final_amount = (
        override_reward if override_reward is not None else assignment.computed_reward
    )
    assignment.computed_reward = final_amount

    assignment.status = KPIAssignmentStatus.APPROVED.value
    assignment.approved_by = actor_id
    assignment.approved_at = datetime.now(timezone.utc)

    if assignment.is_penalty:
        await _settle_deduction(db, assignment, final_amount, actor_id, template)
    else:
        await _settle_bonus(db, assignment, final_amount, actor_id, template)

    assignment.status = KPIAssignmentStatus.PAID.value
    _audit(
        db,
        assignment.company_id,
        event=KPIAuditEvent.PAID,
        actor_id=actor_id,
        assignment_id=assignment.id,
        template_id=template.id,
        payload={
            "amount": float(final_amount),
            "is_penalty": assignment.is_penalty,
        },
    )
    return assignment


async def reject_assignment(
    db: AsyncSession,
    assignment: KPIAssignment,
    actor_id: UUID | None,
    reason: str,
) -> KPIAssignment:
    """Mark an assignment as REJECTED — no salary side-effects.

    If a Bonus/Deduction was already created (re-rejecting after approval),
    delete it so the salary period reflects the new reality.
    """
    if assignment.paid_via_bonus_id:
        bonus = (
            await db.execute(
                select(Bonus).where(Bonus.id == assignment.paid_via_bonus_id)
            )
        ).scalar_one_or_none()
        if bonus:
            await db.delete(bonus)
        assignment.paid_via_bonus_id = None
    if assignment.paid_via_deduction_id:
        ded = (
            await db.execute(
                select(Deduction).where(
                    Deduction.id == assignment.paid_via_deduction_id
                )
            )
        ).scalar_one_or_none()
        if ded:
            await db.delete(ded)
        assignment.paid_via_deduction_id = None
    assignment.status = KPIAssignmentStatus.REJECTED.value
    assignment.notes = (
        (assignment.notes + "\n" if assignment.notes else "") + f"REJECT: {reason}"
    )
    _audit(
        db,
        assignment.company_id,
        event=KPIAuditEvent.REJECTED,
        actor_id=actor_id,
        assignment_id=assignment.id,
        template_id=assignment.kpi_template_id,
        payload={"reason": reason},
    )
    return assignment


__all__ = [
    "FormulaError",
    "KPI_VARIABLE_CATALOG",
    "approve_assignment",
    "collect_variables",
    "recompute_assignment",
    "recompute_company_assignments",
    "reject_assignment",
]
