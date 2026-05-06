// Mirrors the backend's Pydantic response shapes. Kept hand-written so the
// frontend has zero codegen dependencies — when the API changes, update here.

export type Role =
  | "OWNER"
  | "COMPANY_ADMIN"
  | "HR_MANAGER"
  | "BRANCH_MANAGER"
  | "EMPLOYEE"
  | "DEVICE";

export type CompanyPlan = "FREE" | "PRO" | "ENTERPRISE";

export interface PlanInfo {
  plan: CompanyPlan;
  price_uzs: number;
  limits: Record<string, number | null>;
  features: Record<string, boolean>;
}

export interface OwnerStats {
  companies: {
    active: number;
    total: number;
    suspended: number;
    new_30d: number;
  };
  users: number;
  branches: number;
  employees: number;
  by_plan: Record<CompanyPlan, number>;
  recent: Array<{
    id: string;
    name: string;
    slug: string;
    plan: CompanyPlan;
    is_active: boolean;
    created_at: string | null;
  }>;
  expiring_soon: Array<{
    id: string;
    name: string;
    slug: string;
    plan: CompanyPlan;
    subscription_until: string | null;
  }>;
}

export type UserStatus = "ACTIVE" | "INVITED" | "SUSPENDED" | "TERMINATED";

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: "bearer";
  expires_in: number;
}

export interface User {
  id: string;
  company_id: string | null;
  branch_id: string | null;
  username: string;
  email: string | null;
  role: Role;
  status: UserStatus;
  full_name: string | null;
  phone: string | null;
  language: "uz" | "ru" | "en";
  is_active: boolean;
  two_factor_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface Company {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  timezone: string;
  currency: string;
  country: string;
  language_default: "uz" | "ru" | "en";
  plan: CompanyPlan;
  subscription_until: string | null;
  settings: Record<string, unknown>;
  is_active: boolean;
  suspended_at: string | null;
  suspended_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface Branch {
  id: string;
  company_id: string;
  name: string;
  address: string | null;
  photo_url: string | null;
  latitude: number | null;
  longitude: number | null;
  geofence_radius_m: number;
  manager_id: string | null;
  working_hours: Record<string, unknown> | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
}

export interface ApiError {
  code: string;
  message: string;
  params?: Record<string, unknown>;
  errors?: unknown[];
}

// ---------- Phase 2/3/4 entities ---------------------------------------------

export type WorkType = "FIXED_SHIFT" | "FLEXIBLE" | "HYBRID";
export type SalaryType = "MONTHLY" | "HOURLY" | "DAILY" | "KPI_BASED";
export type Gender = "MALE" | "FEMALE" | "OTHER";

export interface Employee {
  id: string;
  company_id: string;
  branch_id: string | null;
  department_id: string | null;
  user_id: string | null;
  employee_code: string;
  full_name: string;
  photo_url: string | null;
  phone: string | null;
  email: string | null;
  position: string | null;
  hire_date: string | null;
  birth_date: string | null;
  gender: Gender | null;
  passport: string | null;
  inn: string | null;
  address: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relation: string | null;
  bank_card_number: string | null;
  bank_name: string | null;
  notes: string | null;
  work_type: WorkType;
  shift_template_id: string | null;
  salary_type: SalaryType;
  base_salary: string | null;
  hourly_rate: string | null;
  daily_rate: string | null;
  overtime_multiplier: string;
  is_active: boolean;
  terminated_at: string | null;
  created_at: string;
  updated_at: string;
}

export type DeviceVendor = "HIKVISION" | "DAHUA" | "ZKTECO" | "GENERIC";
export type DeviceLocationRole = "ENTRY" | "EXIT" | "BOTH";
export type DeviceStatus = "ONLINE" | "OFFLINE" | "MAINTENANCE";

export interface Device {
  id: string;
  company_id: string;
  branch_id: string | null;
  name: string;
  vendor: DeviceVendor;
  model: string | null;
  firmware_version: string | null;
  serial_number: string;
  ip_address: string | null;
  mac_address: string | null;
  location_role: DeviceLocationRole;
  last_seen_at: string | null;
  status: DeviceStatus;
  config: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DeviceCreateResponse {
  device: Device;
  api_key: string;
}

export interface DeviceLog {
  id: string;
  device_id: string;
  event_type: string;
  payload: Record<string, unknown> | null;
  received_at: string;
  employee_id: string | null;
  success: boolean;
  error: string | null;
}

export type NotificationCategory =
  | "SYSTEM"
  | "ATTENDANCE"
  | "SALARY"
  | "KPI"
  | "LEAVE"
  | "DEVICE"
  | "ANOMALY";

export interface AppNotification {
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

export interface NotificationPreferenceItem {
  category: NotificationCategory;
  enabled: boolean;
}

export interface NotificationPreferences {
  items: NotificationPreferenceItem[];
}

// Dashboard --------------------------------------------------------------

export interface DashboardCounts {
  employees_active: number;
  employees_total: number;
  branches: number;
  departments: number;
  devices_online: number;
  devices_offline: number;
  devices_total: number;
}

export interface DashboardAttendance {
  present_today: number;
  late_today: number;
  absent_today: number;
  rest_today: number;
  currently_working: number;
  overtime_minutes_today: number;
}

export interface DashboardLeaves {
  pending_count: number;
  approved_this_month: number;
  rejected_this_month: number;
}

export interface DashboardSalary {
  year: number;
  month: number;
  total_earned: string;
  total_paid: string;
  total_pending: string;
  advances_outstanding: string;
}

export interface DashboardKPI {
  year: number;
  month: number;
  avg_score: string;
  total_reward: string;
  pending_approvals: number;
}

export interface DashboardActivity {
  at: string;
  kind: "attendance" | "leave" | "salary" | "kpi" | "device";
  title: string;
  body: string | null;
  employee_id: string | null;
  employee_name: string | null;
}

export interface AttendanceTrendPoint {
  day: string;
  present: number;
  late: number;
  absent: number;
}

export interface DashboardSummary {
  counts: DashboardCounts;
  attendance: DashboardAttendance;
  leaves: DashboardLeaves;
  salary: DashboardSalary;
  kpi: DashboardKPI;
  recent_activity: DashboardActivity[];
  attendance_trend: AttendanceTrendPoint[];
}

// Attendance --------------------------------------------------------------

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

export type ShiftStatusLabel =
  | "PRESENT"
  | "LATE"
  | "IN_PROGRESS"
  | "ABSENT"
  | "ON_LEAVE"
  | "REST_DAY"
  | "NOT_SCHEDULED";

export interface DailyOverviewRow {
  employee_id: string;
  employee_code: string;
  full_name: string;
  photo_url: string | null;
  branch_id: string | null;
  department_id: string | null;
  position: string | null;

  first_check_in: string | null;
  last_check_out: string | null;
  is_currently_in: boolean;
  minutes_worked: number;
  late_minutes: number;
  overtime_minutes: number;
  shift_status: ShiftStatusLabel;
}

export interface MonthlyOverviewRow {
  employee_id: string;
  employee_code: string;
  full_name: string;
  photo_url: string | null;
  branch_id: string | null;

  days_worked: number;
  total_minutes: number;
  late_minutes: number;
  overtime_minutes: number;
  rest_days_planned: number;
  absence_days: number;
}

// Leaves ------------------------------------------------------------------

export type LeaveStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

export interface LeaveType {
  id: string;
  name: string;
  paid: boolean;
  max_days_per_year: number | null;
  requires_document: boolean;
  is_active: boolean;
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

export interface LeaveAdjustment {
  id: string;
  company_id: string;
  employee_id: string;
  leave_type_id: string;
  year: number;
  days_delta: number;
  amount_delta: string;
  reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeaveBalanceRow {
  employee_id: string;
  employee_code: string;
  full_name: string;
  photo_url: string | null;
  leave_type_id: string;
  leave_type_name: string;
  paid: boolean;
  max_days_per_year: number | null;
  used_days: number;
  remaining: number | null;
  total_paid_amount: string;
}

// Salary ------------------------------------------------------------------

export type PeriodStatus =
  | "DRAFT"
  | "FINALIZED"
  | "APPROVED"
  | "PARTIALLY_PAID"
  | "PAID";

export interface SalaryPeriod {
  id: string;
  company_id: string;
  employee_id: string;
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
  finalized_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  paid_at: string | null;
  notes: string | null;
}

export interface SalaryDashboardSummary {
  year: number;
  month: number;
  employees: number;
  total_earned: string;
  total_paid: string;
  total_pending: string;
  advances_outstanding: string;
  bonuses_total: string;
  deductions_total: string;
  kpi_total: string;
  overtime_total: string;
  by_status: Record<string, number>;
  top_unpaid: TopUnpaidEntry[];
  ytd_paid: string;
}

export interface TopUnpaidEntry {
  employee_id: string;
  full_name: string;
  employee_code: string | null;
  pending_amount: string;
  status: PeriodStatus;
}

export interface BulkActionResult {
  affected: number;
}

export interface SalaryDailyAccrual {
  id: string;
  company_id: string;
  employee_id: string;
  date: string;
  hours_worked: string;
  overtime_hours: string;
  base_earned: string;
  overtime_earned: string;
  bonuses_earned: string;
  kpi_earned: string;
  deductions: string;
  total_earned: string;
  computed_at: string | null;
}

export interface SalaryTodaySnapshot {
  today: SalaryDailyAccrual | null;
  period: SalaryPeriod | null;
  pending_amount: string;
}

export interface PeriodWithEmployee {
  employee_id: string;
  employee_code: string;
  full_name: string;
  photo_url: string | null;
  branch_id: string | null;
  department_id: string | null;
  position: string | null;
  period: SalaryPeriod | null;
  pending_amount: string;
  has_attendance_today: boolean;
}

export type TransactionType = "ADVANCE" | "FULL_PAYMENT" | "BONUS";

export interface SalaryTransaction {
  id: string;
  company_id: string;
  employee_id: string;
  period_id: string | null;
  type: TransactionType;
  amount: string;
  paid_at: string;
  payment_method: string | null;
  reference: string | null;
  notes: string | null;
  created_at: string;
}

export interface BonusRow {
  id: string;
  type: string;
  amount: string;
  reason: string | null;
  applied_date: string;
  auto_generated: boolean;
}

export interface DeductionRow {
  id: string;
  type: string;
  amount: string;
  reason: string | null;
  applied_date: string;
  auto_generated: boolean;
}

export interface SalaryLeaveRow {
  id: string;
  leave_type_name: string;
  paid: boolean;
  start_date: string;
  end_date: string;
  days: number;
  status: string;
  override_amount: string | null;
}

export interface EmployeeBreakdown {
  period: SalaryPeriod | null;
  daily: SalaryDailyAccrual[];
  bonuses: BonusRow[];
  deductions: DeductionRow[];
  transactions: SalaryTransaction[];
  leaves: SalaryLeaveRow[];
}

export interface BulkRecomputeResult {
  queued_employees: number;
  days: number;
}

// Bonuses & Deductions ----------------------------------------------------

export type BonusType = "KPI" | "FIXED" | "OVERTIME" | "PROJECT";
export type DeductionType = "LATE" | "ABSENCE" | "PENALTY" | "TAX" | "ADVANCE";

export interface Bonus {
  id: string;
  company_id: string;
  employee_id: string;
  period_id: string | null;
  type: BonusType;
  amount: string;
  reason: string | null;
  given_by: string | null;
  applied_date: string;
  applied_at: string;
  auto_generated: boolean;
  created_at: string;
}

export interface Deduction {
  id: string;
  company_id: string;
  employee_id: string;
  period_id: string | null;
  type: DeductionType;
  amount: string;
  reason: string | null;
  applied_by: string | null;
  applied_date: string;
  applied_at: string;
  auto_generated: boolean;
  created_at: string;
}

// KPI ---------------------------------------------------------------------

export type KPICategory =
  | "ATTENDANCE"
  | "SALES"
  | "TASKS"
  | "QUALITY"
  | "MANAGER_REVIEW"
  | "GOAL"
  | "CUSTOM";
export type MetricSource = "AUTO" | "MANUAL" | "HYBRID";
export type RewardType =
  | "FIXED"
  | "PERCENT_OF_SALARY"
  | "PER_UNIT"
  | "TIERED"
  | "PENALTY_PERCENT";
export type KPIPeriodKind = "MONTHLY" | "QUARTERLY" | "WEEKLY";
export type KPIAssignmentStatus =
  | "DRAFT"
  | "ACTIVE"
  | "COMPUTED"
  | "APPROVED"
  | "PAID"
  | "REJECTED"
  | "CANCELLED"
  | "COMPLETED";
export type KPIAuditEvent =
  | "CREATED"
  | "UPDATED"
  | "RECOMPUTED"
  | "APPROVED"
  | "REJECTED"
  | "PAID"
  | "CANCELLED"
  | "BULK_ASSIGN"
  | "BULK_RECOMPUTE";

export interface KPITierBracket {
  from_pct: string;
  to_pct: string;
  multiplier: string;
}

export interface KPITemplate {
  id: string;
  company_id: string;
  name: string;
  description: string | null;
  category: KPICategory;
  metric_source: MetricSource;
  formula: string;
  target_value: string;
  unit: string | null;
  weight: string;
  period_kind: KPIPeriodKind;
  min_threshold_pct: string;
  max_score_cap_pct: string | null;
  reward_type: RewardType;
  reward_amount: string;
  tiers: KPITierBracket[] | null;
  requires_manager_review: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface KPIAssignment {
  id: string;
  company_id: string;
  employee_id: string;
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
  last_compute_error: string | null;
  manager_rating: string | null;
  manager_comment: string | null;
  employee_response: string | null;
  approved_by: string | null;
  approved_at: string | null;
  paid_via_bonus_id: string | null;
  paid_via_deduction_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface KPIInputsSnapshot {
  vars: Record<string, number>;
  formula: string;
  reward_type: RewardType;
  min_threshold_pct: number;
  max_score_cap_pct: number | null;
}

export interface KPIAssignmentDetail extends KPIAssignment {
  template_name: string | null;
  template_unit: string | null;
  template_category: KPICategory | null;
  template_period_kind: KPIPeriodKind | null;
  template_reward_type: RewardType | null;
  template_target_value: string | null;
  employee_name: string | null;
  employee_code: string | null;
  employee_branch_id: string | null;
  employee_department_id: string | null;
}

export interface KPIBulkAssignRequest {
  kpi_template_id: string;
  year: number;
  month: number;
  target?: string;
  employee_ids?: string[];
  branch_ids?: string[];
  department_ids?: string[];
  skip_existing?: boolean;
}

export interface KPIBulkAssignResult {
  created: number;
  skipped: number;
  failed: number;
  failures: string[];
}

export interface KPIRecomputeResult {
  recomputed: number;
  failed: number;
  failures: string[];
}

export interface KPIDataPoint {
  id: string;
  company_id: string;
  employee_id: string;
  metric_key: string;
  value: string;
  recorded_at: string;
  recorded_date: string | null;
  source: string | null;
  note: string | null;
  submitted_by: string | null;
  is_void: boolean;
  created_at: string;
}

export interface KPILeaderboardEntry {
  employee_id: string;
  employee_name: string;
  employee_code: string | null;
  branch_id: string | null;
  department_id: string | null;
  total_score: string;
  weighted_score: string;
  total_reward: string;
  total_penalty: string;
  assignments_count: number;
  approved_count: number;
  rank: number;
}

export interface KPIDashboardSummary {
  year: number;
  month: number;
  employees_with_kpis: number;
  total_assignments: number;
  avg_score: string;
  total_reward: string;
  total_penalty: string;
  by_status: Record<string, number>;
  by_category: Record<string, number>;
}

export interface KPIBranchBreakdown {
  branch_id: string | null;
  branch_name: string | null;
  employees: number;
  avg_score: string;
  total_reward: string;
}

export interface KPIScoreTrendPoint {
  year: number;
  month: number;
  avg_score: string;
  total_reward: string;
  assignments: number;
}

export interface KPIAuditLogEntry {
  id: string;
  assignment_id: string | null;
  template_id: string | null;
  event: KPIAuditEvent;
  actor_id: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
}

export interface KPIVariable {
  name: string;
  description: string;
  source: string;
  unit: string | null;
}

// Department --------------------------------------------------------------

export interface Department {
  id: string;
  company_id: string;
  branch_id: string;
  parent_id: string | null;
  name: string;
  code: string | null;
  description: string | null;
  is_active: boolean;
}

// Shifts ------------------------------------------------------------------

export type ShiftType = "FIXED" | "FLEXIBLE" | "SPLIT";
export type ScheduleStatus =
  | "PLANNED"
  | "SWAPPED"
  | "CANCELLED"
  | "ON_LEAVE"
  | "REST_DAY";

export interface Kiosk {
  id: string;
  company_id: string;
  branch_id: string;
  name: string;
  slug: string;
  notes: string | null;
  is_active: boolean;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface KioskCreateResponse {
  kiosk: Kiosk;
  login_url: string;
  password: string;
}

export interface ShiftTemplate {
  id: string;
  company_id: string;
  name: string;
  type: ShiftType;
  start_time: string | null;
  end_time: string | null;
  break_minutes: number;
  expected_hours: string | null;
  allow_overtime: boolean;
  is_active: boolean;
  /** ISO weekdays (1=Mon … 7=Sun) the template is in service on. */
  working_days: number[];
}

export interface ShiftSchedule {
  id: string;
  company_id: string;
  employee_id: string;
  shift_template_id: string | null;
  date: string;
  custom_start: string | null;
  custom_end: string | null;
  status: ScheduleStatus;
}

export interface AuditLogEntry {
  id: string;
  company_id: string | null;
  actor_id: string | null;
  actor_role: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
  actor_username: string | null;
  actor_full_name: string | null;
}

export interface AuditLogActionStat {
  action: string;
  count: number;
}

export type ReportType =
  | "ATTENDANCE_DAILY"
  | "ATTENDANCE_MONTHLY"
  | "SALARY_REGISTER"
  | "EMPLOYEE_ROSTER"
  | "KPI_SUMMARY"
  | "LEAVE_BALANCE"
  | "BONUS_DEDUCTION_REGISTER"
  | "LATE_ABSENCE_TREND";

export type ReportFormat = "CSV" | "PDF" | "XLSX";
export type ReportStatus = "PENDING" | "RUNNING" | "READY" | "FAILED";

export interface ReportJob {
  id: string;
  company_id: string;
  type: ReportType;
  format: ReportFormat;
  status: ReportStatus;
  params: Record<string, unknown>;
  requested_by: string | null;
  file_url: string | null;
  row_count: number | null;
  started_at: string | null;
  finished_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}
