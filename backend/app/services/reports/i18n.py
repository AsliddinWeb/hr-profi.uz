"""Localisation tables for report headers + cell values.

Generators yield English internally so the service code stays uniform;
``localize_report`` rewrites the headers and known categorical cells
(status / direction / salary type / employee state) to the user's
language right before the renderer sees them.

PDF status pills key their CSS class off the ENGLISH status code, so
``localize_report`` also returns a ``label_to_class`` map the template
uses to attach the right colour without hardcoding Uzbek class names.
"""
from __future__ import annotations

from app.models.report import ReportType

Locale = str  # "uz" | "ru" | "en"


# ---------- Column header translations -------------------------------------

# Each report's English header tuple → per-locale header tuple. We key by
# report type instead of one big global dict because the same English
# token (e.g. "Status") means different things in different reports.
HEADER_LABELS: dict[str, dict[str, dict[Locale, str]]] = {
    ReportType.ATTENDANCE_DAILY.value: {
        "Employee code": {"uz": "Xodim kodi", "ru": "Код сотрудника", "en": "Employee code"},
        "Full name": {"uz": "F.I.Sh.", "ru": "Ф.И.О.", "en": "Full name"},
        "Branch": {"uz": "Filial", "ru": "Филиал", "en": "Branch"},
        "Department": {"uz": "Bo'lim", "ru": "Отдел", "en": "Department"},
        "Date": {"uz": "Sana", "ru": "Дата", "en": "Date"},
        "First in": {"uz": "Birinchi kirish", "ru": "Приход", "en": "First in"},
        "Last out": {"uz": "Oxirgi chiqish", "ru": "Уход", "en": "Last out"},
        "Worked (h:mm)": {"uz": "Ishlangan (s:dd)", "ru": "Отработано (ч:мм)", "en": "Worked (h:mm)"},
        "Late (min)": {"uz": "Kech (min)", "ru": "Опоздание (мин)", "en": "Late (min)"},
        "OT (min)": {"uz": "Overtime (min)", "ru": "Сверхурочно (мин)", "en": "OT (min)"},
        "Status": {"uz": "Holat", "ru": "Статус", "en": "Status"},
    },
    ReportType.ATTENDANCE_MONTHLY.value: {
        "Employee code": {"uz": "Xodim kodi", "ru": "Код сотрудника", "en": "Employee code"},
        "Full name": {"uz": "F.I.Sh.", "ru": "Ф.И.О.", "en": "Full name"},
        "Branch": {"uz": "Filial", "ru": "Филиал", "en": "Branch"},
        "Department": {"uz": "Bo'lim", "ru": "Отдел", "en": "Department"},
        "Year-Month": {"uz": "Yil-Oy", "ru": "Год-Месяц", "en": "Year-Month"},
        "Days worked": {"uz": "Ishlangan kunlar", "ru": "Отработано дней", "en": "Days worked"},
        "Total hours": {"uz": "Jami soat", "ru": "Всего часов", "en": "Total hours"},
        "Late (min)": {"uz": "Kech (min)", "ru": "Опоздание (мин)", "en": "Late (min)"},
        "OT (min)": {"uz": "Overtime (min)", "ru": "Сверхурочно (мин)", "en": "OT (min)"},
        "Absent days": {"uz": "Kelmagan kunlar", "ru": "Прогулы", "en": "Absent days"},
        "Leave days": {"uz": "Ta'til kunlari", "ru": "Отпуск (дней)", "en": "Leave days"},
        "Rest days": {"uz": "Dam kunlari", "ru": "Выходных", "en": "Rest days"},
    },
    ReportType.SALARY_REGISTER.value: {
        "Employee code": {"uz": "Xodim kodi", "ru": "Код сотрудника", "en": "Employee code"},
        "Full name": {"uz": "F.I.Sh.", "ru": "Ф.И.О.", "en": "Full name"},
        "Branch": {"uz": "Filial", "ru": "Филиал", "en": "Branch"},
        "Department": {"uz": "Bo'lim", "ru": "Отдел", "en": "Department"},
        "Year-Month": {"uz": "Yil-Oy", "ru": "Год-Месяц", "en": "Year-Month"},
        "Base": {"uz": "Asos", "ru": "Оклад", "en": "Base"},
        "Overtime": {"uz": "Overtime", "ru": "Сверхурочно", "en": "Overtime"},
        "Bonuses": {"uz": "Bonuslar", "ru": "Бонусы", "en": "Bonuses"},
        "KPI": {"uz": "KPI", "ru": "KPI", "en": "KPI"},
        "Deductions": {"uz": "Jarimalar", "ru": "Удержания", "en": "Deductions"},
        "Total earned": {"uz": "Jami daromad", "ru": "Итого начислено", "en": "Total earned"},
        "Paid": {"uz": "To'langan", "ru": "Выплачено", "en": "Paid"},
        "Pending": {"uz": "Qoldiq", "ru": "Остаток", "en": "Pending"},
        "Status": {"uz": "Holat", "ru": "Статус", "en": "Status"},
    },
    ReportType.EMPLOYEE_ROSTER.value: {
        "Code": {"uz": "Kod", "ru": "Код", "en": "Code"},
        "Full name": {"uz": "F.I.Sh.", "ru": "Ф.И.О.", "en": "Full name"},
        "Position": {"uz": "Lavozim", "ru": "Должность", "en": "Position"},
        "Branch": {"uz": "Filial", "ru": "Филиал", "en": "Branch"},
        "Department": {"uz": "Bo'lim", "ru": "Отдел", "en": "Department"},
        "Phone": {"uz": "Telefon", "ru": "Телефон", "en": "Phone"},
        "Email": {"uz": "Email", "ru": "Email", "en": "Email"},
        "Hire date": {"uz": "Ishga olingan", "ru": "Принят", "en": "Hire date"},
        "Salary type": {"uz": "Maosh turi", "ru": "Тип оплаты", "en": "Salary type"},
        "Base salary": {"uz": "Asosiy maosh", "ru": "Оклад", "en": "Base salary"},
        "Daily rate": {"uz": "Kunlik tarif", "ru": "Дневная ставка", "en": "Daily rate"},
        "Hourly rate": {"uz": "Soatlik tarif", "ru": "Часовая ставка", "en": "Hourly rate"},
        "Status": {"uz": "Holat", "ru": "Статус", "en": "Status"},
    },
    ReportType.KPI_SUMMARY.value: {
        "Employee code": {"uz": "Xodim kodi", "ru": "Код сотрудника", "en": "Employee code"},
        "Full name": {"uz": "F.I.Sh.", "ru": "Ф.И.О.", "en": "Full name"},
        "Branch": {"uz": "Filial", "ru": "Филиал", "en": "Branch"},
        "Department": {"uz": "Bo'lim", "ru": "Отдел", "en": "Department"},
        "Year-Month": {"uz": "Yil-Oy", "ru": "Год-Месяц", "en": "Year-Month"},
        "Assignments": {"uz": "Tayinlovlar", "ru": "Назначений", "en": "Assignments"},
        "Avg score (%)": {"uz": "O'rtacha (%)", "ru": "Средний балл (%)", "en": "Avg score (%)"},
        "Approved": {"uz": "Tasdiqlangan", "ru": "Утверждено", "en": "Approved"},
        "Pending": {"uz": "Kutilmoqda", "ru": "В ожидании", "en": "Pending"},
        "Total reward": {"uz": "Jami mukofot", "ru": "Всего вознаграждение", "en": "Total reward"},
        "Total penalty": {"uz": "Jami jarima", "ru": "Всего штраф", "en": "Total penalty"},
    },
    ReportType.LEAVE_BALANCE.value: {
        "Employee code": {"uz": "Xodim kodi", "ru": "Код сотрудника", "en": "Employee code"},
        "Full name": {"uz": "F.I.Sh.", "ru": "Ф.И.О.", "en": "Full name"},
        "Branch": {"uz": "Filial", "ru": "Филиал", "en": "Branch"},
        "Year": {"uz": "Yil", "ru": "Год", "en": "Year"},
        "Leave type": {"uz": "Ta'til turi", "ru": "Тип отпуска", "en": "Leave type"},
        "Paid": {"uz": "Pulli", "ru": "Оплачиваемый", "en": "Paid"},
        "Annual cap": {"uz": "Yillik limit", "ru": "Годовой лимит", "en": "Annual cap"},
        "Used (days)": {"uz": "Ishlatilgan (kun)", "ru": "Использовано (дней)", "en": "Used (days)"},
        "Remaining": {"uz": "Qolgan", "ru": "Остаток", "en": "Remaining"},
    },
    ReportType.BONUS_DEDUCTION_REGISTER.value: {
        "Date": {"uz": "Sana", "ru": "Дата", "en": "Date"},
        "Direction": {"uz": "Yo'nalish", "ru": "Направление", "en": "Direction"},
        "Employee code": {"uz": "Xodim kodi", "ru": "Код сотрудника", "en": "Employee code"},
        "Full name": {"uz": "F.I.Sh.", "ru": "Ф.И.О.", "en": "Full name"},
        "Branch": {"uz": "Filial", "ru": "Филиал", "en": "Branch"},
        "Type": {"uz": "Tur", "ru": "Тип", "en": "Type"},
        "Amount": {"uz": "Summa", "ru": "Сумма", "en": "Amount"},
        "Auto": {"uz": "Avto", "ru": "Авто", "en": "Auto"},
        "Reason": {"uz": "Sabab", "ru": "Причина", "en": "Reason"},
    },
    ReportType.LATE_ABSENCE_TREND.value: {
        "Employee code": {"uz": "Xodim kodi", "ru": "Код сотрудника", "en": "Employee code"},
        "Full name": {"uz": "F.I.Sh.", "ru": "Ф.И.О.", "en": "Full name"},
        "Branch": {"uz": "Filial", "ru": "Филиал", "en": "Branch"},
        "Date range": {"uz": "Davr", "ru": "Период", "en": "Date range"},
        "Late count": {"uz": "Kech soni", "ru": "Опозданий", "en": "Late count"},
        "Late minutes": {"uz": "Kech (min)", "ru": "Опоздание (мин)", "en": "Late minutes"},
        "Avg late (min)": {"uz": "O'rtacha kech (min)", "ru": "Среднее (мин)", "en": "Avg late (min)"},
        "Absent days": {"uz": "Kelmagan kunlar", "ru": "Прогулов", "en": "Absent days"},
        "Worst day late (min)": {"uz": "Eng kech kun (min)", "ru": "Макс. опоздание (мин)", "en": "Worst day late (min)"},
    },
}


# ---------- Cell-value translations ----------------------------------------

# Status / state codes — keyed by ENGLISH code so generators can keep
# yielding English. Renderer-side lookup translates display only.
STATUS_LABELS: dict[str, dict[Locale, str]] = {
    # Attendance
    "PRESENT": {"uz": "Kelgan", "ru": "Присутствует", "en": "Present"},
    "LATE": {"uz": "Kechikkan", "ru": "Опоздал", "en": "Late"},
    "ABSENT": {"uz": "Kelmagan", "ru": "Отсутствует", "en": "Absent"},
    "ON_LEAVE": {"uz": "Ta'tilda", "ru": "В отпуске", "en": "On leave"},
    "REST_DAY": {"uz": "Dam kuni", "ru": "Выходной", "en": "Rest day"},
    "NOT_SCHEDULED": {"uz": "Rejada yo'q", "ru": "Не в графике", "en": "Not scheduled"},
    # Salary period lifecycle
    "DRAFT": {"uz": "Qoralama", "ru": "Черновик", "en": "Draft"},
    "FINALIZED": {"uz": "Yakunlangan", "ru": "Финализировано", "en": "Finalized"},
    "APPROVED": {"uz": "Tasdiqlangan", "ru": "Утверждено", "en": "Approved"},
    "PARTIALLY_PAID": {"uz": "Qisman to'langan", "ru": "Частично выплачено", "en": "Partially paid"},
    "PAID": {"uz": "To'langan", "ru": "Выплачено", "en": "Paid"},
    # Bonus/deduction direction
    "BONUS": {"uz": "Bonus", "ru": "Бонус", "en": "Bonus"},
    "DEDUCTION": {"uz": "Jarima", "ru": "Удержание", "en": "Deduction"},
    # Employee lifecycle
    "active": {"uz": "Faol", "ru": "Активен", "en": "Active"},
    "inactive": {"uz": "Nofaol", "ru": "Неактивен", "en": "Inactive"},
    "terminated": {"uz": "Ishdan bo'shatilgan", "ru": "Уволен", "en": "Terminated"},
    # Salary type enum (employee roster column)
    "MONTHLY": {"uz": "Oylik", "ru": "Месячная", "en": "Monthly"},
    "HOURLY": {"uz": "Soatbay", "ru": "Почасовая", "en": "Hourly"},
    "DAILY": {"uz": "Kunbay", "ru": "Дневная", "en": "Daily"},
    "KPI_BASED": {"uz": "KPI", "ru": "KPI", "en": "KPI"},
}


# Per-report-type, the columns whose CELL VALUES should be translated via
# STATUS_LABELS (status/direction/lifecycle). Column index is 0-based.
# NOTE: ``localize_report`` runs BEFORE ``add_row_numbers``, so these
# indices are against the ORIGINAL generator output (no "№" column yet).
LOCALIZED_COLUMNS: dict[str, list[int]] = {
    ReportType.ATTENDANCE_DAILY.value: [10],          # "Status"
    ReportType.SALARY_REGISTER.value: [13],           # "Status"
    ReportType.EMPLOYEE_ROSTER.value: [8, 12],        # "Salary type", "Status"
    ReportType.BONUS_DEDUCTION_REGISTER.value: [1],   # "Direction"
}


# Set of localized status labels — needed by the PDF template to know
# which cells should render as a coloured pill. Built lazily to keep
# ``localize_report`` cheap on hot paths.
def localized_status_labels(locale: Locale = "uz") -> set[str]:
    return {labels.get(locale, code) for code, labels in STATUS_LABELS.items()}


def status_label_to_class_map(locale: Locale = "uz") -> dict[str, str]:
    """label → ENGLISH code for CSS class lookup. The PDF stylesheet
    keys off the English code (``status-pill.PRESENT``) so we don't
    need to expand the CSS for every locale."""
    return {
        labels.get(locale, code): code for code, labels in STATUS_LABELS.items()
    }


def add_row_numbers(
    headers: list[str], rows: list[list[str]]
) -> tuple[list[str], list[list[str]]]:
    """Prepend a 1-based ``№`` column so the printed PDF/XLSX gives
    every row an obvious sequential ID. Run AFTER ``localize_report``
    because the renderer's column-index metadata (numeric columns,
    pill columns, totals layout) is expressed against the post-prepend
    layout."""
    new_headers = ["№"] + list(headers)
    new_rows = [[str(i + 1)] + list(r) for i, r in enumerate(rows)]
    return new_headers, new_rows


def localize_report(
    report_type: str,
    headers: list[str],
    rows: list[list[str]],
    locale: Locale = "uz",
) -> tuple[list[str], list[list[str]]]:
    """Rewrite English headers + status-like cells to the requested locale.

    Headers fall back to themselves when no translation is registered (so
    a brand-new report doesn't crash the renderer). Cell values likewise
    fall back to themselves — anything we don't know about (e.g. a free-
    form bonus type) passes through verbatim.
    """
    if locale not in ("uz", "ru", "en"):
        locale = "uz"

    header_map = HEADER_LABELS.get(report_type, {})
    new_headers = [
        header_map.get(h, {}).get(locale, h) for h in headers
    ]

    cols_to_localize = LOCALIZED_COLUMNS.get(report_type, [])
    if not cols_to_localize:
        return new_headers, rows

    new_rows: list[list[str]] = []
    for r in rows:
        row = list(r)
        for col in cols_to_localize:
            if 0 <= col < len(row):
                code = row[col]
                row[col] = STATUS_LABELS.get(code, {}).get(locale, code)
        new_rows.append(row)
    return new_headers, new_rows
