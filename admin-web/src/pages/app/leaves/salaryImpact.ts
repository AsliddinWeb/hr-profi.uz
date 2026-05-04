/**
 * Compute the per-day base for an employee's salary, mirroring backend
 * `_per_day_base()`. Used by the leave Create/Edit pages to preview how much
 * a paid leave costs payroll before the admin clicks save.
 */
import type { Company, Employee, ShiftTemplate } from "@/lib/types";

const HOURS_PER_DAY = 8;
const WORK_DAYS_PER_MONTH = 22;

export function workingDaysFromCompany(company: Company | null | undefined): number {
  const wd = (company?.settings as { working_days?: unknown } | undefined)?.working_days;
  if (Array.isArray(wd) && wd.length > 0) return Math.round(wd.length * 4.33);
  return WORK_DAYS_PER_MONTH;
}

export function hoursPerDayFromTemplate(template: ShiftTemplate | null | undefined): number {
  if (!template?.expected_hours) return HOURS_PER_DAY;
  const n = Number(template.expected_hours);
  return Number.isFinite(n) && n > 0 ? n : HOURS_PER_DAY;
}

export interface PayDayBaseInputs {
  employee: Employee;
  hoursPerDay?: number;
  daysPerMonth?: number;
}

/** One day's base pay for an employee — same logic as backend
 * `_per_day_base()`. Returns 0 for KPI_BASED or employees with no rate. */
export function perDayBase({
  employee,
  hoursPerDay = HOURS_PER_DAY,
  daysPerMonth = WORK_DAYS_PER_MONTH,
}: PayDayBaseInputs): number {
  if (employee.salary_type === "MONTHLY" && employee.base_salary) {
    return (Number(employee.base_salary) || 0) / daysPerMonth;
  }
  if (employee.salary_type === "DAILY" && employee.daily_rate) {
    return Number(employee.daily_rate) || 0;
  }
  if (employee.salary_type === "HOURLY" && employee.hourly_rate) {
    return (Number(employee.hourly_rate) || 0) * hoursPerDay;
  }
  return 0;
}

export function fmtMoney(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  return Math.round(n).toLocaleString("ru-RU").replace(/,/g, " ");
}
