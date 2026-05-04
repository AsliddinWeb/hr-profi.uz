import type { Role, User, UserStatus } from "@/lib/types";

export const CREATABLE_ROLES: Role[] = [
  "COMPANY_ADMIN",
  "HR_MANAGER",
  "BRANCH_MANAGER",
];

export interface UserFormState {
  username: string;
  email: string;
  full_name: string;
  phone: string;
  password: string;
  role: Role;
  language: "uz" | "ru" | "en";
  status: UserStatus;
  is_active: boolean;
  /** Required when role=BRANCH_MANAGER, ignored otherwise. Empty string means
   * "no branch selected"; the form turns this into ``null`` on submit. */
  branch_id: string;
}

export const emptyUserForm: UserFormState = {
  username: "",
  email: "",
  full_name: "",
  phone: "",
  password: "",
  role: "HR_MANAGER",
  language: "uz",
  status: "ACTIVE",
  is_active: true,
  branch_id: "",
};

export function fromUser(u: User): UserFormState {
  return {
    username: u.username,
    email: u.email ?? "",
    full_name: u.full_name ?? "",
    phone: u.phone ?? "",
    password: "",
    role: u.role,
    language: u.language as "uz" | "ru" | "en",
    status: u.status,
    is_active: u.is_active,
    branch_id: u.branch_id ?? "",
  };
}

/** Tone for the role badge — keeps the table scannable at a glance. */
export const ROLE_TONE: Record<
  Role,
  "info" | "success" | "warning" | "default" | "danger"
> = {
  OWNER: "danger",
  COMPANY_ADMIN: "info",
  HR_MANAGER: "success",
  BRANCH_MANAGER: "warning",
  EMPLOYEE: "default",
  DEVICE: "default",
};

/** Tone for the user-status pill (lifecycle, not auth state). */
export const STATUS_TONE: Record<
  UserStatus,
  "success" | "warning" | "danger" | "default"
> = {
  ACTIVE: "success",
  INVITED: "warning",
  SUSPENDED: "danger",
  TERMINATED: "default",
};

/** YYYY-MM-DD HH:MM in local timezone. */
export function fmtDateTime(iso: string | null | undefined, locale: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(locale, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
