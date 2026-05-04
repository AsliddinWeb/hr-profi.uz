"""Per-employee self-service report — what an EMPLOYEE downloads from the
PWA's Oylik / Davomat tarixi pages.

Single combined month-summary for a self-serving employee:
  - One header section showing the period totals (days worked, OT, base,
    bonuses, KPI, deductions, net total).
  - One detail table with daily breakdown.

Renders straight to PDF (most useful format to print or forward) — no
queue, no row in the report_jobs table, no cross-tenant leak risk
because the only employee_id we look up is the caller's.
"""
from __future__ import annotations

import io
from datetime import date as Date
from datetime import datetime, time, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from uuid import UUID

from jinja2 import Environment, FileSystemLoader, select_autoescape
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.attendance import AttendanceRecord, AttendanceStatus, CheckType
from app.models.company import Company
from app.models.employee import Employee
from app.models.salary import SalaryDailyAccrual, SalaryPeriod
from app.models.user import User

_TEMPLATE_DIR = Path(__file__).parent / "templates"
_jinja = Environment(
    loader=FileSystemLoader(str(_TEMPLATE_DIR)),
    autoescape=select_autoescape(["html", "xml"]),
    trim_blocks=True,
    lstrip_blocks=True,
)


_LABELS = {
    "title": {
        "uz": "Shaxsiy oylik hisobot",
        "ru": "Личный месячный отчёт",
        "en": "Personal monthly report",
    },
    "section_summary": {
        "uz": "Davr xulasasi",
        "ru": "Свод за период",
        "en": "Period summary",
    },
    "section_daily": {
        "uz": "Kunlik hisob",
        "ru": "Ежедневный расчёт",
        "en": "Daily breakdown",
    },
    "days_worked": {"uz": "Ishlangan kunlar", "ru": "Отработано дней", "en": "Days worked"},
    "minutes_worked": {"uz": "Ishlangan vaqt", "ru": "Отработано", "en": "Worked"},
    "ot_minutes": {"uz": "Overtime", "ru": "Сверхурочные", "en": "Overtime"},
    "late_minutes": {"uz": "Kech kelish", "ru": "Опоздания", "en": "Late"},
    "absent_days": {"uz": "Kelmagan kunlar", "ru": "Прогулы", "en": "Absent days"},
    "leave_days": {"uz": "Ta'tilda", "ru": "В отпуске", "en": "On leave"},
    "base": {"uz": "Asos", "ru": "Оклад", "en": "Base"},
    "overtime": {"uz": "Overtime to'lovi", "ru": "Оплата сверхурочных", "en": "Overtime pay"},
    "bonuses": {"uz": "Bonuslar", "ru": "Бонусы", "en": "Bonuses"},
    "kpi": {"uz": "KPI", "ru": "KPI", "en": "KPI"},
    "deductions": {"uz": "Jarimalar", "ru": "Удержания", "en": "Deductions"},
    "total_earned": {"uz": "Jami daromad", "ru": "Итого начислено", "en": "Total earned"},
    "paid": {"uz": "To'langan", "ru": "Выплачено", "en": "Paid"},
    "pending": {"uz": "Qoldiq", "ru": "Остаток", "en": "Pending"},
    "col_date": {"uz": "Sana", "ru": "Дата", "en": "Date"},
    "col_hours": {"uz": "Soat", "ru": "Часы", "en": "Hours"},
    "col_ot": {"uz": "OT", "ru": "OT", "en": "OT"},
    "col_status": {"uz": "Holat", "ru": "Статус", "en": "Status"},
    "col_in": {"uz": "Keldi", "ru": "Пришёл", "en": "In"},
    "col_out": {"uz": "Ketdi", "ru": "Ушёл", "en": "Out"},
    "col_late": {"uz": "Kech (min)", "ru": "Опоздание (мин)", "en": "Late (min)"},
    "col_base": {"uz": "Asos", "ru": "Оклад", "en": "Base"},
    "col_total": {"uz": "Jami", "ru": "Итого", "en": "Total"},
    "generated_at": {"uz": "Yaratilgan", "ru": "Сформировано", "en": "Generated"},
    "ym": {"uz": "Davr", "ru": "Период", "en": "Period"},
    "employee": {"uz": "Xodim", "ru": "Сотрудник", "en": "Employee"},
}


def _t(key: str, locale: str) -> str:
    return _LABELS[key].get(locale, _LABELS[key]["uz"])


def _hm(minutes: int) -> str:
    return f"{minutes // 60}:{str(minutes % 60).zfill(2)}"


async def render_personal_pdf(
    db: AsyncSession,
    user: User,
    *,
    year: int,
    month: int,
    locale: str = "uz",
) -> bytes:
    """Render the calling employee's monthly PDF.

    No cross-tenant filter manipulation needed: we look up the Employee
    row by ``user.id`` and only use that employee's daily accruals +
    attendance records. Period totals come from the existing
    ``salary_periods`` aggregate.
    """
    if locale not in ("uz", "ru", "en"):
        locale = "uz"

    emp = (
        await db.execute(
            select(Employee).where(Employee.user_id == user.id)
        )
    ).scalar_one_or_none()
    if not emp:
        raise RuntimeError("employee.not_found")

    company = (
        await db.execute(
            select(Company)
            .where(Company.id == emp.company_id)
            .execution_options(skip_tenant_filter=True)
        )
    ).scalar_one()

    # Period summary
    period = (
        await db.execute(
            select(SalaryPeriod).where(
                SalaryPeriod.employee_id == emp.id,
                SalaryPeriod.year == year,
                SalaryPeriod.month == month,
            )
        )
    ).scalar_one_or_none()

    # Daily accruals — already aggregated by the salary engine, perfect
    # for the per-day breakdown column.
    daily = (
        await db.execute(
            select(SalaryDailyAccrual)
            .where(
                SalaryDailyAccrual.employee_id == emp.id,
                SalaryDailyAccrual.date >= Date(year, month, 1),
                SalaryDailyAccrual.date
                < (Date(year + 1, 1, 1) if month == 12 else Date(year, month + 1, 1)),
            )
            .order_by(SalaryDailyAccrual.date.asc())
        )
    ).scalars().all()
    daily_by_date = {d.date: d for d in daily}

    # Attendance records to surface the actual in/out timestamps + late.
    month_start = Date(year, month, 1)
    next_month = (
        Date(year + 1, 1, 1) if month == 12 else Date(year, month + 1, 1)
    )
    start_dt = datetime.combine(month_start, time.min, tzinfo=timezone.utc)
    end_dt = datetime.combine(next_month, time.min, tzinfo=timezone.utc)
    recs = (
        await db.execute(
            select(AttendanceRecord)
            .where(
                AttendanceRecord.employee_id == emp.id,
                AttendanceRecord.timestamp >= start_dt,
                AttendanceRecord.timestamp < end_dt,
                AttendanceRecord.status != AttendanceStatus.REJECTED,
            )
            .order_by(AttendanceRecord.timestamp.asc())
        )
    ).scalars().all()

    by_day: dict[Date, list[AttendanceRecord]] = {}
    for r in recs:
        by_day.setdefault(r.timestamp.date(), []).append(r)

    rows: list[dict] = []
    days_in_month = (next_month - month_start).days
    cur = month_start
    while cur < next_month:
        day_recs = by_day.get(cur, [])
        first_in = next(
            (r for r in day_recs if r.check_type == CheckType.CHECK_IN), None
        )
        last_out = next(
            (r for r in reversed(day_recs) if r.check_type == CheckType.CHECK_OUT),
            None,
        )
        late_min = sum(int(r.late_minutes or 0) for r in day_recs)
        accrual = daily_by_date.get(cur)
        hours = float(accrual.hours_worked) if accrual else 0.0
        ot = float(accrual.overtime_hours) if accrual else 0.0
        base = int(round(float(accrual.base_earned))) if accrual else 0
        total = int(round(float(accrual.total_earned))) if accrual else 0

        # Skip empty rows for trailing days of the future when we know
        # nothing happened — keeps the PDF tidy. The period summary already
        # captures totals.
        is_future = cur > Date.today()
        is_blank = (
            not day_recs
            and (accrual is None or float(accrual.total_earned or 0) == 0)
        )
        if is_future and is_blank:
            cur += timedelta(days=1)
            continue

        rows.append(
            {
                "date": cur.isoformat(),
                "in": first_in.timestamp.strftime("%H:%M") if first_in else "—",
                "out": last_out.timestamp.strftime("%H:%M") if last_out else "—",
                "hours": f"{hours:.1f}" if hours else "—",
                "ot": f"{ot:.1f}" if ot else "—",
                "late": str(late_min) if late_min else "—",
                "base": f"{base:,}".replace(",", " ") if base else "—",
                "total": f"{total:,}".replace(",", " ") if total else "—",
                "status": "ON_LEAVE" if (
                    accrual and float(accrual.base_earned or 0) > 0 and not day_recs
                ) else ("PRESENT" if day_recs else "ABSENT" if cur < Date.today() else ""),
            }
        )
        cur += timedelta(days=1)

    summary = {
        "days_worked": sum(1 for r in rows if r["hours"] != "—"),
        "minutes_worked": int(
            sum(float(r["hours"]) for r in rows if r["hours"] != "—") * 60
        ),
        "ot_hours": sum(float(r["ot"]) for r in rows if r["ot"] != "—"),
        "late_minutes": sum(int(r["late"]) for r in rows if r["late"] != "—"),
        "absent_days": sum(1 for r in rows if r["status"] == "ABSENT"),
        "leave_days": sum(1 for r in rows if r["status"] == "ON_LEAVE"),
        "base": int(round(float(period.base_amount))) if period else 0,
        "overtime": int(round(float(period.overtime_amount))) if period else 0,
        "bonuses": int(round(float(period.bonuses_total))) if period else 0,
        "kpi": int(round(float(period.kpi_amount))) if period else 0,
        "deductions": int(round(float(period.deductions_total))) if period else 0,
        "total_earned": int(round(float(period.total_earned))) if period else 0,
        "paid": int(round(float(period.paid_amount))) if period else 0,
    }
    summary["pending"] = summary["total_earned"] - summary["paid"]

    base_css = (_TEMPLATE_DIR / "_base.css").read_text(encoding="utf-8")
    rendered = _jinja.get_template("personal.html.j2").render(
        base_css=base_css,
        title=_t("title", locale),
        company_name=company.name,
        company_initial=(company.name or "W")[:1].upper(),
        employee_name=emp.full_name or emp.employee_code,
        employee_code=emp.employee_code,
        ym=f"{year}-{month:02d}",
        ym_label=_t("ym", locale),
        employee_label=_t("employee", locale),
        generated_at=datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
        generated_at_label=_t("generated_at", locale),
        labels={k: _t(k, locale) for k in _LABELS},
        summary=summary,
        rows=rows,
        worked_hm=_hm(summary["minutes_worked"]),
    )

    from weasyprint import HTML

    return HTML(string=rendered).write_pdf()
