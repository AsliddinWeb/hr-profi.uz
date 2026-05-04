// Mirror the backend response shapes — kept hand-written so we have no
// codegen dependency. Update here when the API changes.

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
  status: "ACTIVE" | "INVITED" | "SUSPENDED" | "TERMINATED";
  full_name: string | null;
  phone: string | null;
  language: "uz" | "ru" | "en";
  is_active: boolean;
  two_factor_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export type CheckType = "CHECK_IN" | "CHECK_OUT";
export type AttendanceMethod = "MOBILE_APP" | "FACE_DEVICE" | "QR_CODE" | "MANUAL";
export type AttendanceRecordStatus = "VALID" | "SUSPICIOUS" | "REJECTED";

export interface AttendanceRecord {
  id: string;
  company_id: string;
  employee_id: string;
  branch_id: string | null;
  check_type: CheckType;
  method: AttendanceMethod;
  timestamp: string;
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  selfie_url: string | null;
  face_match_score: string | null;
  is_late: boolean;
  late_minutes: number;
  is_early_leave: boolean;
  overtime_minutes: number;
  status: AttendanceRecordStatus;
  notes: string | null;
  created_at: string;
}

export type ScheduleStatus =
  | "PLANNED"
  | "SWAPPED"
  | "CANCELLED"
  | "ON_LEAVE"
  | "REST_DAY";

export type ShiftType = "FIXED" | "FLEXIBLE" | "SPLIT";

export interface MyShiftRow {
  id: string;
  date: string;
  status: ScheduleStatus;
  template_name: string | null;
  template_type: ShiftType | null;
  start_time: string | null;
  end_time: string | null;
  break_minutes: number | null;
  expected_hours: string | null;
}

export type PeriodStatus =
  | "DRAFT"
  | "FINALIZED"
  | "APPROVED"
  | "PARTIALLY_PAID"
  | "PAID";

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
  status: PeriodStatus;
}

export interface SalaryTodaySnapshot {
  today: SalaryDailyAccrual | null;
  period: SalaryPeriod | null;
  pending_amount: string;
}

export type KPICategory =
  | "ATTENDANCE"
  | "SALES"
  | "TASKS"
  | "QUALITY"
  | "MANAGER_REVIEW"
  | "GOAL"
  | "CUSTOM";

export type KPIAssignmentStatus =
  | "DRAFT"
  | "ACTIVE"
  | "COMPUTED"
  | "APPROVED"
  | "PAID"
  | "REJECTED"
  | "CANCELLED"
  | "COMPLETED";

export interface KPIAssignmentDetail {
  id: string;
  year: number;
  month: number;
  target: string;
  actual: string;
  score: string;
  weight_at_assignment: string;
  computed_reward: string;
  is_penalty: boolean;
  status: KPIAssignmentStatus;
  manager_rating: string | null;
  manager_comment: string | null;
  approved_at: string | null;
  template_name: string | null;
  template_unit: string | null;
  template_category: KPICategory | null;
}

export type LeaveStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

export interface LeaveType {
  id: string;
  company_id: string;
  name: string;
  paid: boolean;
  max_days_per_year: number | null;
  requires_document: boolean;
  is_active: boolean;
  created_at: string;
}

export interface LeaveRequest {
  id: string;
  company_id: string;
  employee_id: string;
  leave_type_id: string;
  start_date: string;
  end_date: string;
  days: number;
  reason: string | null;
  document_url: string | null;
  override_amount: string | null;
  status: LeaveStatus;
  approved_by: string | null;
  approved_at: string | null;
  decision_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeaveRequestCreatePayload {
  leave_type_id: string;
  start_date: string;
  end_date: string;
  reason?: string | null;
  document_url?: string | null;
}

export type NotificationCategory =
  | "SYSTEM"
  | "ATTENDANCE"
  | "SALARY"
  | "KPI"
  | "LEAVE"
  | "DEVICE"
  | "ANOMALY";

export interface NotificationItem {
  id: string;
  company_id: string | null;
  user_id: string;
  category: NotificationCategory;
  title: string;
  body: string | null;
  payload: Record<string, unknown> | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

export interface NotificationsPage {
  items: NotificationItem[];
  total: number;
  page: number;
  size: number;
}

export interface PushPublicKey {
  public_key: string;
}
