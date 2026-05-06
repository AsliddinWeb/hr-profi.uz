"""Salary computation.

The hot path is ``recompute_for_day(employee_id, day)``, called from a Celery
task after every check-out. It:

1. Aggregates the day's attendance into hours_worked + overtime_hours.
2. Computes base/overtime earnings using the employee's salary_type+rate.
3. Sums bonuses/deductions whose ``applied_date == day`` (auto-generated late
   penalties get inserted here too).
4. Upserts ``SalaryDailyAccrual`` for the day.
5. Recomputes the month's ``SalaryPeriod`` totals.

We deliberately keep this idempotent — running twice on the same day produces
the same numbers — so retries (Celery, manual triggers, missed events) are
safe.
"""
from __future__ import annotations

from datetime import date as Date
from datetime import datetime, time, timedelta, timezone
from decimal import Decimal
from uuid import UUID

from sqlalchemy import and_, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
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
from app.models.company import Company
from app.models.employee import Employee, SalaryType
from app.models.salary import (
    PeriodStatus,
    SalaryDailyAccrual,
    SalaryPeriod,
    SalaryTransaction,
    TransactionType,
)


def _day_bounds_utc(day: Date) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time.min, tzinfo=timezone.utc)
    return start, start + timedelta(days=1)


async def _hours_for_day(
    db: AsyncSession, employee_id: UUID, day: Date
) -> tuple[Decimal, Decimal]:
    """Return ``(hours_worked, overtime_hours)`` derived from VALID rows.

    Strategy:
      - Pair CHECK_IN with the next CHECK_OUT and count the gap.
      - Trailing unpaired CHECK_IN — common when the device's CHECK_OUT
        was REJECTED (out-of-geofence) or the employee is still inside —
        is closed virtually:
          • for *today*, run from CHECK_IN to NOW so the employee accrues
            base pay live as the shift progresses.
          • for *past days*, close at the assigned shift template's
            end_time, or 23:59 of the day if no template is set. This
            stops a forgotten check-out from forfeiting an entire day's
            pay; admins can still amend via /attendance/manual.
    """
    start, end = _day_bounds_utc(day)
    rows = (
        await db.execute(
            select(AttendanceRecord)
            .where(
                AttendanceRecord.employee_id == employee_id,
                AttendanceRecord.timestamp >= start,
                AttendanceRecord.timestamp < end,
                AttendanceRecord.status != AttendanceStatus.REJECTED,
            )
            .order_by(AttendanceRecord.timestamp.asc())
        )
    ).scalars().all()

    minutes_worked = 0
    overtime_minutes = 0
    pending_in: AttendanceRecord | None = None
    for r in rows:
        if r.check_type == CheckType.CHECK_IN:
            pending_in = r
        elif r.check_type == CheckType.CHECK_OUT and pending_in is not None:
            delta = (r.timestamp - pending_in.timestamp).total_seconds() / 60
            if delta > 0:
                minutes_worked += int(delta)
            overtime_minutes += r.overtime_minutes
            pending_in = None

    if pending_in is not None:
        # Determine a virtual close-out time.
        now = datetime.now(timezone.utc)
        is_today = day == now.date()
        if is_today:
            close_at = now
        else:
            # Past day — fall back to the assigned shift template's end_time
            # if available; otherwise cap at end of day.
            close_at = end
            from app.models.employee import Employee
            from app.models.shift import ShiftTemplate

            employee = (
                await db.execute(
                    select(Employee)
                    .where(Employee.id == employee_id)
                    .execution_options(skip_tenant_filter=True)
                )
            ).scalar_one_or_none()
            if employee and employee.shift_template_id:
                tpl = (
                    await db.execute(
                        select(ShiftTemplate).where(
                            ShiftTemplate.id == employee.shift_template_id
                        )
                    )
                ).scalar_one_or_none()
                if tpl and tpl.end_time:
                    close_at = datetime.combine(
                        day, tpl.end_time, tzinfo=timezone.utc
                    )
        delta = (close_at - pending_in.timestamp).total_seconds() / 60
        if delta > 0:
            minutes_worked += int(delta)

    hours = Decimal(minutes_worked) / Decimal(60)
    ot = Decimal(overtime_minutes) / Decimal(60)
    return hours.quantize(Decimal("0.01")), ot.quantize(Decimal("0.01"))


async def _bonuses_for_day(
    db: AsyncSession, employee_id: UUID, day: Date
) -> tuple[Decimal, Decimal]:
    """Returns ``(bonuses_earned, kpi_earned)`` so KPI can be reported separately."""
    rows = (
        await db.execute(
            select(Bonus.type, func.coalesce(func.sum(Bonus.amount), 0))
            .where(Bonus.employee_id == employee_id, Bonus.applied_date == day)
            .group_by(Bonus.type)
        )
    ).all()

    bonuses = Decimal(0)
    kpi = Decimal(0)
    for btype, amount in rows:
        if btype == BonusType.KPI.value or btype == BonusType.KPI:
            kpi += Decimal(amount)
        else:
            bonuses += Decimal(amount)
    return bonuses, kpi


async def _deductions_for_day(
    db: AsyncSession, employee_id: UUID, day: Date
) -> Decimal:
    total = (
        await db.execute(
            select(func.coalesce(func.sum(Deduction.amount), 0)).where(
                Deduction.employee_id == employee_id,
                Deduction.applied_date == day,
            )
        )
    ).scalar_one()
    return Decimal(total)


def _base_earned_for_day(employee: Employee, hours: Decimal) -> Decimal:
    """Pro-rated daily base, depending on salary_type.

    For MONTHLY employees, base is proportional to hours actually worked
    against the expected 8-hour day (i.e. ``monthly / 22 / 8 * hours``).
    A full-shift presence pays the full daily base; a 10-minute appearance
    pays ~10/480 of it. Hours above 8 cap at 8 — the surplus rolls into
    ``overtime_hours`` upstream and earns the OT multiplier separately.
    """
    if employee.salary_type == SalaryType.HOURLY:
        rate = employee.hourly_rate or Decimal(0)
        return (rate * hours).quantize(Decimal("0.01"))

    if employee.salary_type == SalaryType.DAILY:
        # Full daily rate if any hours were logged. (Half-day rules are out
        # of scope for Phase 3.)
        rate = employee.daily_rate or Decimal(0)
        return rate.quantize(Decimal("0.01")) if hours > 0 else Decimal("0.00")

    if employee.salary_type == SalaryType.MONTHLY:
        monthly = employee.base_salary or Decimal(0)
        if hours <= 0 or monthly <= 0:
            return Decimal("0.00")
        expected_daily = Decimal("8.00")
        # Cap to a full day so overtime hours don't double-pay through the
        # base (they'll come back in via _overtime_earned at OT multiplier).
        billable = hours if hours <= expected_daily else expected_daily
        per_hour = monthly / Decimal(22) / expected_daily
        return (per_hour * billable).quantize(Decimal("0.01"))

    # KPI_BASED: no base accrual; reward comes purely from KPI bonuses.
    return Decimal("0.00")


def _overtime_earned(
    employee: Employee, overtime_hours: Decimal, hourly_rate: Decimal
) -> Decimal:
    if overtime_hours <= 0:
        return Decimal("0.00")
    multiplier = employee.overtime_multiplier or Decimal("1.5")
    return (hourly_rate * overtime_hours * multiplier).quantize(Decimal("0.01"))


def _effective_hourly_rate(employee: Employee) -> Decimal:
    if employee.hourly_rate:
        return Decimal(employee.hourly_rate)
    if employee.daily_rate:
        return (Decimal(employee.daily_rate) / Decimal(8)).quantize(Decimal("0.01"))
    if employee.base_salary:
        # 22 working days × 8 hours = 176 / month.
        return (Decimal(employee.base_salary) / Decimal(176)).quantize(Decimal("0.01"))
    return Decimal("0.00")


async def _ensure_period(
    db: AsyncSession, employee: Employee, day: Date
) -> SalaryPeriod:
    """Find or create the open SalaryPeriod for (employee, year, month)."""
    period = (
        await db.execute(
            select(SalaryPeriod).where(
                SalaryPeriod.employee_id == employee.id,
                SalaryPeriod.year == day.year,
                SalaryPeriod.month == day.month,
            )
        )
    ).scalar_one_or_none()
    if period is not None:
        return period
    period = SalaryPeriod(
        company_id=employee.company_id,
        employee_id=employee.id,
        year=day.year,
        month=day.month,
        status=PeriodStatus.DRAFT,
    )
    db.add(period)
    await db.flush()
    return period


async def _is_rest_day(db: AsyncSession, employee_id: UUID, day: Date) -> bool:
    """True if the employee's schedule for this date is marked REST_DAY.

    Rest days are individually assigned in the monthly shift planner; on those
    dates the system (a) does not generate absence/late penalties, and (b)
    reclassifies any hours actually worked as overtime.
    """
    from app.models.shift import ScheduleStatus, ShiftSchedule

    stmt = (
        select(ShiftSchedule.status)
        .where(ShiftSchedule.employee_id == employee_id, ShiftSchedule.date == day)
        .execution_options(skip_tenant_filter=True)
    )
    row = (await db.execute(stmt)).scalar_one_or_none()
    return row == ScheduleStatus.REST_DAY.value or row == ScheduleStatus.REST_DAY


async def _approved_leave_on(
    db: AsyncSession, employee_id: UUID, day: Date
) -> "tuple[bool, Decimal | None, int] | None":
    """If the employee has an APPROVED leave covering ``day``, return
    ``(paid, override_amount, days)``. Otherwise ``None``.

    Used by the recompute engine: paid leave accrues a normal day's base pay
    (or ``override_amount / days`` when the admin set one) and suppresses
    absence/late deductions; unpaid leave only suppresses the deductions.
    Either way, no actual check-in is required.
    """
    from app.models.leave import LeaveRequest, LeaveStatus, LeaveType

    stmt = (
        select(LeaveRequest, LeaveType)
        .join(LeaveType, LeaveType.id == LeaveRequest.leave_type_id)
        .where(
            LeaveRequest.employee_id == employee_id,
            LeaveRequest.status == LeaveStatus.APPROVED.value,
            LeaveRequest.start_date <= day,
            LeaveRequest.end_date >= day,
        )
        .execution_options(skip_tenant_filter=True)
        .limit(1)
    )
    row = (await db.execute(stmt)).first()
    if not row:
        return None
    req, lt = row
    return (bool(lt.paid), req.override_amount, int(req.days or 1))


def _per_day_base(employee: Employee, hours_per_day: int = 8, days_per_month: int = 22) -> Decimal:
    """Daily base used for ABSENCE deductions. Returns 0 for KPI_BASED or
    employees with no rate set."""
    if employee.salary_type == SalaryType.MONTHLY and employee.base_salary:
        return (Decimal(employee.base_salary) / Decimal(days_per_month)).quantize(Decimal("0.01"))
    if employee.salary_type == SalaryType.DAILY and employee.daily_rate:
        return Decimal(employee.daily_rate).quantize(Decimal("0.01"))
    if employee.salary_type == SalaryType.HOURLY and employee.hourly_rate:
        return (Decimal(employee.hourly_rate) * Decimal(hours_per_day)).quantize(Decimal("0.01"))
    return Decimal("0.00")


def _is_working_day(day: Date, company: Company) -> bool:
    """A day counts as working iff its ISO weekday (Mon=1..Sun=7) is in
    ``company.settings.working_days``. Defaults to Mon–Fri when the setting
    is missing or invalid."""
    raw = company.settings.get("working_days", [1, 2, 3, 4, 5])
    if not isinstance(raw, list):
        raw = [1, 2, 3, 4, 5]
    iso = day.isoweekday()
    return iso in raw


async def _autogenerate_absence_deduction(
    db: AsyncSession, employee: Employee, day: Date, company: Company
) -> None:
    """Insert/refresh an auto-deduction when the employee skipped a working day.

    Triggers iff:
    - The day is strictly before today (we don't penalise the in-progress day).
    - The day is on/after the employee's ``hire_date`` (no penalising days
      before they were employed).
    - The day is a working day for the EMPLOYEE — uses their assigned shift
      template's ``working_days`` when available, else the company-wide
      ``working_days``. So a Mon-Sat employee assigned a Mon-Fri template
      isn't penalised for missing Saturday.
    - The day's ShiftSchedule isn't ``CANCELLED`` / ``ON_LEAVE`` /
      ``REST_DAY`` — those are intentional absences.
    - The employee has zero VALID check-ins on the day.
    - The company hasn't disabled the feature via
      ``settings.absence_penalty_enabled = false``.

    Amount mirrors a normal day's pay (pro-rated for MONTHLY; full daily rate
    for DAILY; hourly_rate × expected_hours for HOURLY). KPI_BASED employees
    are skipped — they have no base to deduct from.
    """
    today = datetime.now(timezone.utc).date()
    if day >= today:
        return
    if company.settings.get("absence_penalty_enabled", True) is False:
        return
    if employee.hire_date is not None and day < employee.hire_date:
        return  # before they joined the company

    # Decide "is today a working day" using the employee's template first,
    # company default as fallback.
    is_workday: bool
    template = None
    if employee.shift_template_id:
        from app.models.shift import ShiftTemplate

        template = (
            await db.execute(
                select(ShiftTemplate).where(
                    ShiftTemplate.id == employee.shift_template_id
                )
            )
        ).scalar_one_or_none()
    if template is not None and template.working_days:
        is_workday = day.isoweekday() in (template.working_days or [])
    else:
        is_workday = _is_working_day(day, company)
    if not is_workday:
        return

    # Honour intentional non-work statuses on the day's ShiftSchedule.
    from app.models.shift import ScheduleStatus, ShiftSchedule

    sched = (
        await db.execute(
            select(ShiftSchedule).where(
                ShiftSchedule.employee_id == employee.id,
                ShiftSchedule.date == day,
            )
        )
    ).scalar_one_or_none()
    if sched is not None:
        sched_status = (
            sched.status.value if hasattr(sched.status, "value") else str(sched.status)
        )
        if sched_status in (
            ScheduleStatus.CANCELLED.value,
            ScheduleStatus.ON_LEAVE.value,
            ScheduleStatus.REST_DAY.value,
        ):
            return

    # Already had a valid check-in? Then it's not an absence — late deductions
    # are handled separately.
    start, end = _day_bounds_utc(day)
    has_check_in = (
        await db.execute(
            select(func.count(AttendanceRecord.id)).where(
                AttendanceRecord.employee_id == employee.id,
                AttendanceRecord.check_type == CheckType.CHECK_IN,
                AttendanceRecord.timestamp >= start,
                AttendanceRecord.timestamp < end,
                AttendanceRecord.status != AttendanceStatus.REJECTED,
            )
        )
    ).scalar_one()
    if has_check_in and has_check_in > 0:
        return

    amount = _per_day_base(employee)
    if amount <= 0:
        return

    # Replace any prior auto-ABSENCE row for this day so re-running the
    # recompute doesn't pile up duplicates.
    await db.execute(
        Deduction.__table__.delete().where(
            Deduction.employee_id == employee.id,
            Deduction.applied_date == day,
            Deduction.type == DeductionType.ABSENCE.value,
            Deduction.auto_generated.is_(True),
        )
    )
    db.add(
        Deduction(
            company_id=employee.company_id,
            employee_id=employee.id,
            type=DeductionType.ABSENCE,
            amount=amount,
            reason="Auto: no check-in on a working day",
            applied_date=day,
            applied_at=datetime.now(timezone.utc),
            auto_generated=True,
        )
    )


async def _autogenerate_late_deduction(
    db: AsyncSession, employee: Employee, day: Date
) -> None:
    """Insert/refresh an auto-deduction for late minutes on this day, if the
    company's ``late_penalty_per_min`` is set."""
    company = (
        await db.execute(
            select(Company)
            .where(Company.id == employee.company_id)
            .execution_options(skip_tenant_filter=True)
        )
    ).scalar_one()
    penalty_per_min = Decimal(str(company.settings.get("late_penalty_per_min", 0)))
    if penalty_per_min <= 0:
        return

    start, end = _day_bounds_utc(day)
    late_total = (
        await db.execute(
            select(func.coalesce(func.sum(AttendanceRecord.late_minutes), 0)).where(
                AttendanceRecord.employee_id == employee.id,
                AttendanceRecord.check_type == CheckType.CHECK_IN,
                AttendanceRecord.timestamp >= start,
                AttendanceRecord.timestamp < end,
                AttendanceRecord.status != AttendanceStatus.REJECTED,
            )
        )
    ).scalar_one()
    if late_total <= 0:
        return

    amount = (penalty_per_min * Decimal(int(late_total))).quantize(Decimal("0.01"))
    # Replace previous auto-LATE row for this day so re-running the recompute
    # doesn't pile up duplicates.
    await db.execute(
        Deduction.__table__.delete().where(
            Deduction.employee_id == employee.id,
            Deduction.applied_date == day,
            Deduction.type == DeductionType.LATE.value,
            Deduction.auto_generated.is_(True),
        )
    )
    db.add(
        Deduction(
            company_id=employee.company_id,
            employee_id=employee.id,
            type=DeductionType.LATE,
            amount=amount,
            reason=f"{int(late_total)} late minutes × {penalty_per_min}",
            applied_date=day,
            applied_at=datetime.now(timezone.utc),
            auto_generated=True,
        )
    )


async def recompute_for_day(
    db: AsyncSession, employee_id: UUID, day: Date
) -> SalaryDailyAccrual:
    """Idempotent: recompute and upsert ``SalaryDailyAccrual`` for one day.

    Caller must commit. Returns the (refreshed) accrual."""
    employee = (
        await db.execute(
            select(Employee)
            .where(Employee.id == employee_id)
            .execution_options(skip_tenant_filter=True)
        )
    ).scalar_one()

    # Rest-day handling: when this date is the employee's individually-planned
    # day off, we (1) skip the late-deduction sweep entirely and (2) reclassify
    # any hours actually worked as overtime, since the company policy is that
    # voluntary rest-day work is paid at the overtime rate.
    is_rest = await _is_rest_day(db, employee_id, day)

    # Approved-leave handling: a paid leave day pays a normal day's base pay
    # without requiring a check-in; an unpaid one zeroes base pay. Either way,
    # late and absence sweeps are suppressed — the employee was authorised to
    # be absent.
    leave = await _approved_leave_on(db, employee_id, day)

    if not is_rest and leave is None:
        company = (
            await db.execute(
                select(Company)
                .where(Company.id == employee.company_id)
                .execution_options(skip_tenant_filter=True)
            )
        ).scalar_one()
        await _autogenerate_late_deduction(db, employee, day)
        await _autogenerate_absence_deduction(db, employee, day, company)

    hours, overtime_hours = await _hours_for_day(db, employee_id, day)
    if is_rest and hours > 0:
        overtime_hours = (overtime_hours + hours).quantize(Decimal("0.01"))
        hours = Decimal("0.00")
    base_earned = _base_earned_for_day(employee, hours)
    if leave is not None:
        paid, override_total, leave_days = leave
        # Paid leave → accrue a notional full day's base. Unpaid → 0.
        # Admin-set override (per-leave total) wins: distribute uniformly
        # across the leave's day count.
        if paid:
            if override_total is not None and leave_days > 0:
                base_earned = (override_total / Decimal(leave_days)).quantize(Decimal("0.01"))
            else:
                base_earned = _per_day_base(employee)
        else:
            base_earned = Decimal("0.00")
    overtime_earned = _overtime_earned(employee, overtime_hours, _effective_hourly_rate(employee))
    bonuses, kpi = await _bonuses_for_day(db, employee_id, day)
    deductions = await _deductions_for_day(db, employee_id, day)

    total = (base_earned + overtime_earned + bonuses + kpi - deductions).quantize(
        Decimal("0.01")
    )
    now = datetime.now(timezone.utc)

    payload = {
        "company_id": employee.company_id,
        "employee_id": employee_id,
        "date": day,
        "hours_worked": hours,
        "overtime_hours": overtime_hours,
        "base_earned": base_earned,
        "overtime_earned": overtime_earned,
        "bonuses_earned": bonuses,
        "kpi_earned": kpi,
        "deductions": deductions,
        "total_earned": total,
        "computed_at": now,
    }

    stmt = pg_insert(SalaryDailyAccrual).values(payload)
    upsert = stmt.on_conflict_do_update(
        index_elements=["employee_id", "date"],
        set_={k: stmt.excluded[k] for k in payload if k not in ("company_id", "employee_id", "date")},
    )
    await db.execute(upsert)

    # Reload the canonical row (with id) for downstream callers.
    accrual = (
        await db.execute(
            select(SalaryDailyAccrual).where(
                SalaryDailyAccrual.employee_id == employee_id,
                SalaryDailyAccrual.date == day,
            )
        )
    ).scalar_one()

    await _refresh_period_totals(db, employee, day.year, day.month)
    return accrual


async def _refresh_period_totals(
    db: AsyncSession, employee: Employee, year: int, month: int
) -> SalaryPeriod:
    """Aggregate the period's accruals into the SalaryPeriod row."""
    period = await _ensure_period(db, employee, Date(year, month, 1))

    totals = (
        await db.execute(
            select(
                func.coalesce(func.sum(SalaryDailyAccrual.base_earned), 0),
                func.coalesce(func.sum(SalaryDailyAccrual.overtime_earned), 0),
                func.coalesce(func.sum(SalaryDailyAccrual.bonuses_earned), 0),
                func.coalesce(func.sum(SalaryDailyAccrual.kpi_earned), 0),
                func.coalesce(func.sum(SalaryDailyAccrual.deductions), 0),
                func.coalesce(func.sum(SalaryDailyAccrual.total_earned), 0),
            ).where(
                SalaryDailyAccrual.employee_id == employee.id,
                func.extract("year", SalaryDailyAccrual.date) == year,
                func.extract("month", SalaryDailyAccrual.date) == month,
            )
        )
    ).one()
    base, ot, bonuses, kpi, deductions, total = (Decimal(t) for t in totals)
    period.base_amount = base
    period.overtime_amount = ot
    period.bonuses_total = bonuses
    period.kpi_amount = kpi
    period.deductions_total = deductions
    period.total_earned = total
    return period


async def recompute_period(
    db: AsyncSession, employee_id: UUID, year: int, month: int
) -> int:
    """Recompute every day in (year, month) for one employee. Returns the
    number of days processed. Caller is responsible for commit semantics.

    We recompute the **entire** month, including future days. That sounds
    wrong at first — won't future work days pre-accrue base pay? — but
    ``_base_earned_for_day`` already returns 0 for HOURLY/DAILY/MONTHLY when
    ``hours <= 0``, which is always the case for a future day. The only
    days that *do* accrue are those covered by an approved paid leave (the
    employee is contractually entitled to that pay regardless of whether
    the day has arrived yet) or rest days, both of which the engine handles
    correctly. Capping at "today" used to mask a real bug: when an admin
    approved a leave covering future days, the daily-accrual rows for those
    days kept stale 0 base values until the day actually rolled over.
    """
    from calendar import monthrange

    days_in_month = monthrange(year, month)[1]
    for d in range(1, days_in_month + 1):
        await recompute_for_day(db, employee_id, Date(year, month, d))
    return days_in_month


async def get_today_snapshot(
    db: AsyncSession, employee_id: UUID, day: Date | None = None
) -> tuple[SalaryDailyAccrual | None, SalaryPeriod | None]:
    today = day or datetime.now(timezone.utc).date()
    accrual = (
        await db.execute(
            select(SalaryDailyAccrual).where(
                SalaryDailyAccrual.employee_id == employee_id,
                SalaryDailyAccrual.date == today,
            )
        )
    ).scalar_one_or_none()
    period = (
        await db.execute(
            select(SalaryPeriod).where(
                SalaryPeriod.employee_id == employee_id,
                SalaryPeriod.year == today.year,
                SalaryPeriod.month == today.month,
            )
        )
    ).scalar_one_or_none()
    return accrual, period


# ============ Approval / payment workflow =================================


async def approve_period(
    db: AsyncSession,
    period: SalaryPeriod,
    actor_id: UUID | None,
    *,
    notes: str | None = None,
) -> SalaryPeriod:
    """Lock the period for review/payment. Sets ``status = APPROVED`` + audit
    fields. Does NOT recompute — approval freezes whatever totals are
    currently on the row. Admin should hit "Recompute" first if they want a
    fresh snapshot before approving.

    Idempotent: re-approving an APPROVED/PAID period is a no-op.
    """
    if period.status in (
        PeriodStatus.APPROVED.value,
        PeriodStatus.PAID.value,
    ):
        if notes:
            period.notes = notes
        return period

    period.status = PeriodStatus.APPROVED.value
    period.approved_at = datetime.now(timezone.utc)
    period.approved_by = actor_id
    # Keep finalized_at populated for legacy clients still reading it.
    if period.finalized_at is None:
        period.finalized_at = period.approved_at
    if notes:
        period.notes = notes
    return period


async def mark_period_paid(
    db: AsyncSession,
    period: SalaryPeriod,
    actor_id: UUID | None,
    *,
    payment_method: str | None = "cash",
    reference: str | None = None,
    paid_at: datetime | None = None,
) -> tuple[SalaryPeriod, SalaryTransaction | None]:
    """Auto-create a FULL_PAYMENT transaction covering the remaining pending
    amount and mark the period PAID.

    Returns ``(period, created_transaction_or_None)``. If pending == 0 (e.g.
    advances already covered the full amount), only the status is updated;
    no extra transaction is created.
    """
    pending = (period.total_earned or Decimal(0)) - (period.paid_amount or Decimal(0))
    when = paid_at or datetime.now(timezone.utc)

    txn: SalaryTransaction | None = None
    if pending > 0:
        txn = SalaryTransaction(
            company_id=period.company_id,
            employee_id=period.employee_id,
            period_id=period.id,
            type=TransactionType.FULL_PAYMENT.value,
            amount=pending,
            paid_at=when,
            payment_method=payment_method,
            reference=reference,
            notes=f"auto-mark-paid by={actor_id}" if actor_id else "auto-mark-paid",
        )
        db.add(txn)
        period.paid_amount = (period.paid_amount or Decimal(0)) + pending

    period.status = PeriodStatus.PAID.value
    period.paid_at = when
    if period.approved_at is None:
        period.approved_at = when
        period.approved_by = actor_id
    return period, txn


async def reopen_period(
    db: AsyncSession,
    period: SalaryPeriod,
    actor_id: UUID | None,
) -> SalaryPeriod:
    """Reverse APPROVED → DRAFT (admin made a mistake). Keeps payments
    intact; if any payment exists, refuse reopen — caller must void payments
    first."""
    if (period.paid_amount or Decimal(0)) > 0:
        raise ValueError("period_has_payments")
    period.status = PeriodStatus.DRAFT.value
    period.approved_at = None
    period.approved_by = None
    period.finalized_at = None
    return period


# ----------------------------------------------------------------------------
# Bulk operations: month-end close, bulk approve/pay
# ----------------------------------------------------------------------------


async def recompute_company_month(
    db: AsyncSession,
    company_id: UUID,
    year: int,
    month: int,
) -> dict[str, int]:
    """Recompute every day of (year, month) for every active employee in the
    company. Used by the month-end close batch and the admin "Recompute all"
    button."""
    employees = (
        await db.execute(
            select(Employee).where(
                Employee.company_id == company_id, Employee.is_active.is_(True)
            )
        )
    ).scalars().all()
    days = 0
    for e in employees:
        days += await recompute_period(db, e.id, year, month)
    return {"employees": len(employees), "days": days}


async def bulk_approve_company(
    db: AsyncSession,
    company_id: UUID,
    year: int,
    month: int,
    actor_id: UUID | None,
) -> int:
    """Approve every DRAFT/FINALIZED period in the company for the month.
    Returns the count of periods touched."""
    rows = (
        await db.execute(
            select(SalaryPeriod).where(
                SalaryPeriod.company_id == company_id,
                SalaryPeriod.year == year,
                SalaryPeriod.month == month,
                SalaryPeriod.status.in_(
                    [
                        PeriodStatus.DRAFT.value,
                        PeriodStatus.FINALIZED.value,
                    ]
                ),
            )
        )
    ).scalars().all()
    for p in rows:
        await approve_period(db, p, actor_id)
    return len(rows)


async def bulk_mark_paid_company(
    db: AsyncSession,
    company_id: UUID,
    year: int,
    month: int,
    actor_id: UUID | None,
    *,
    payment_method: str | None = "cash",
) -> int:
    """Mark every APPROVED period in the month as PAID, creating a
    FULL_PAYMENT transaction for each remaining pending amount."""
    rows = (
        await db.execute(
            select(SalaryPeriod).where(
                SalaryPeriod.company_id == company_id,
                SalaryPeriod.year == year,
                SalaryPeriod.month == month,
                SalaryPeriod.status.in_(
                    [
                        PeriodStatus.APPROVED.value,
                        PeriodStatus.FINALIZED.value,
                        PeriodStatus.PARTIALLY_PAID.value,
                    ]
                ),
            )
        )
    ).scalars().all()
    paid = 0
    for p in rows:
        # Only mark periods that actually have something earned. Empty
        # periods (e.g. employee on full-month leave with 0 base) get
        # skipped.
        if (p.total_earned or Decimal(0)) > 0:
            await mark_period_paid(
                db, p, actor_id, payment_method=payment_method
            )
            paid += 1
    return paid


__all__ = [
    "approve_period",
    "bulk_approve_company",
    "bulk_mark_paid_company",
    "get_today_snapshot",
    "mark_period_paid",
    "recompute_company_month",
    "recompute_for_day",
    "recompute_period",
    "reopen_period",
]
