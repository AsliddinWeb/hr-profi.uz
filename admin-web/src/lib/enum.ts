import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

export type EnumKind =
  | "role"
  | "user_status"
  | "company_plan"
  | "salary_type"
  | "work_type"
  | "shift_type"
  | "schedule_status"
  | "check_type"
  | "attendance_method"
  | "attendance_status"
  | "leave_status"
  | "period_status"
  | "transaction_type"
  | "bonus_type"
  | "deduction_type"
  | "kpi_category"
  | "metric_source"
  | "reward_type"
  | "kpi_period_kind"
  | "kpi_assignment_status"
  | "kpi_audit_event"
  | "notification_category"
  | "device_vendor"
  | "device_location_role"
  | "device_status"
  | "gender"
  | "shift_status_label";

/**
 * Functional helper. Returns a human-readable label for a backend enum
 * value. If the translation key is missing we fall back to the raw value
 * so we never silently render an empty cell.
 */
export function enumLabel(t: TFunction, kind: EnumKind, value: string | null | undefined): string {
  if (!value) return "—";
  return t(`enums.${kind}.${value}`, { defaultValue: value });
}

/** Same thing but as a hook so components can call it without threading t. */
export function useEnumLabel() {
  const { t } = useTranslation();
  return (kind: EnumKind, value: string | null | undefined) => enumLabel(t, kind, value);
}
