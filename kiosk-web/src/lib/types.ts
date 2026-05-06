/* Mirrors the kiosk-runtime backend schemas. Keep in sync with
 * backend/app/schemas/kiosk.py. */

export interface KioskRead {
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

export interface KioskBranchInfo {
  id: string;
  name: string;
  address: string | null;
}

export interface KioskCompanyInfo {
  id: string;
  name: string;
  logo_url: string | null;
  settings: Record<string, unknown> | null;
}

export interface KioskMeResponse {
  kiosk: KioskRead;
  branch: KioskBranchInfo;
  company: KioskCompanyInfo;
}

export interface KioskEmployee {
  id: string;
  employee_code: string | null;
  full_name: string;
  photo_url: string | null;
  department_name: string | null;
  position: string | null;
  is_currently_in: boolean;
}

export interface KioskEmployeeList {
  items: KioskEmployee[];
  total: number;
}

export interface KioskAttendanceResponse {
  employee: KioskEmployee;
  check_type: "CHECK_IN" | "CHECK_OUT";
  timestamp: string;
  is_late: boolean;
  late_minutes: number;
  overtime_minutes: number;
}

export interface KioskLoginResponse {
  access_token: string;
  token_type: string;
  kiosk: KioskRead;
}

export interface KioskRecognizeMatch {
  employee: KioskEmployee;
  score: number;
}

export interface KioskRecognizeResponse {
  matched: boolean;
  match: KioskRecognizeMatch | null;
  reason: string | null;
}

export interface ApiError {
  message: string;
  code?: string;
  details?: unknown;
}
