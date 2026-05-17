// Mirrors the backend's Pydantic shapes — kept hand-written.

export type Role =
  | "OWNER"
  | "COMPANY_ADMIN"
  | "HR_MANAGER"
  | "BRANCH_MANAGER"
  | "EMPLOYEE"
  | "DEVICE";

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: "bearer";
  expires_in: number;
}

export interface User {
  id: string;
  company_id: string | null;
  username: string;
  email: string | null;
  role: Role;
  full_name: string | null;
  phone: string | null;
  language: "uz" | "ru" | "en";
  is_active: boolean;
}

export interface Employee {
  id: string;
  company_id: string;
  branch_id: string | null;
  department_id: string | null;
  user_id: string | null;
  full_name: string;
  employee_code: string;
  position: string | null;
  photo_url: string | null;
  phone: string | null;
  email: string | null;
  hire_date: string | null;
  birth_date: string | null;
  address: string | null;
  work_type: "FIXED_SHIFT" | "FLEXIBLE" | "HYBRID";
  salary_type: "MONTHLY" | "HOURLY" | "DAILY" | "KPI_BASED";
  base_salary: string | null;
  hourly_rate: string | null;
  daily_rate: string | null;
  overtime_multiplier: string;
  is_active: boolean;
}

export interface AttendanceRecord {
  id: string;
  employee_id: string;
  check_type: "CHECK_IN" | "CHECK_OUT";
  method: "MOBILE_APP" | "FACE_DEVICE" | "QR_CODE" | "MANUAL";
  timestamp: string;
  latitude: number | null;
  longitude: number | null;
  is_late: boolean;
  late_minutes: number;
  overtime_minutes: number;
  status: "VALID" | "SUSPICIOUS" | "REJECTED";
}

export interface TodayStatus {
  first_check_in: string | null;
  last_check_out: string | null;
  is_working: boolean;
  minutes_worked_today: number;
}

export interface SalaryDailyAccrual {
  id: string;
  date: string;
  hours_worked: string;
  overtime_hours: string;
  base_earned: string;
  overtime_earned: string;
  bonuses_earned: string;
  kpi_earned: string;
  deductions: string;
  total_earned: string;
}

export interface SalaryPeriod {
  id: string;
  year: number;
  month: number;
  base_amount: string;
  bonuses_total: string;
  deductions_total: string;
  overtime_amount: string;
  kpi_amount: string;
  total_earned: string;
  paid_amount: string;
  status: "DRAFT" | "FINALIZED" | "PAID";
}

export interface SalaryTodaySnapshot {
  today: SalaryDailyAccrual | null;
  period: SalaryPeriod | null;
  pending_amount: string;
}

export interface ShiftSchedule {
  id: string;
  employee_id: string;
  date: string;
  shift_template_id: string | null;
  custom_start: string | null;
  custom_end: string | null;
  status: "PLANNED" | "SWAPPED" | "CANCELLED" | "ON_LEAVE";
}

export type KPICategory =
  | "ATTENDANCE"
  | "SALES"
  | "TASKS"
  | "QUALITY"
  | "MANAGER_REVIEW"
  | "GOAL"
  | "CUSTOM";
export type KPIPeriodKind = "MONTHLY" | "QUARTERLY" | "WEEKLY";
export type RewardType =
  | "FIXED"
  | "PERCENT_OF_SALARY"
  | "PER_UNIT"
  | "TIERED"
  | "PENALTY_PERCENT";
export type KPIAssignmentStatus =
  | "DRAFT"
  | "ACTIVE"
  | "COMPUTED"
  | "APPROVED"
  | "PAID"
  | "REJECTED"
  | "CANCELLED"
  | "COMPLETED";

export interface KPIInputsSnapshot {
  vars: Record<string, number>;
  formula: string;
  reward_type: RewardType;
  min_threshold_pct: number;
  max_score_cap_pct: number | null;
}

export interface KPIAssignment {
  id: string;
  kpi_template_id: string;
  year: number;
  month: number;
  target: string;
  actual: string;
  score: string;
  weight_at_assignment: string;
  computed_reward: string;
  is_penalty: boolean;
  status: KPIAssignmentStatus;
  inputs_snapshot: KPIInputsSnapshot | null;
  last_computed_at: string | null;
  manager_rating: string | null;
  manager_comment: string | null;
  employee_response: string | null;
  approved_at: string | null;
  notes: string | null;
}

export interface KPIAssignmentDetail extends KPIAssignment {
  template_name: string | null;
  template_unit: string | null;
  template_category: KPICategory | null;
  template_period_kind: KPIPeriodKind | null;
  template_reward_type: RewardType | null;
  template_target_value: string | null;
}

export interface LeaveRequest {
  id: string;
  leave_type_id: string;
  start_date: string;
  end_date: string;
  days: number;
  reason: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  created_at: string;
}

export interface LeaveType {
  id: string;
  name: string;
  paid: boolean;
  max_days_per_year: number | null;
  requires_document: boolean;
}

export interface ApiError {
  code: string;
  message: string;
  params?: Record<string, unknown>;
}
