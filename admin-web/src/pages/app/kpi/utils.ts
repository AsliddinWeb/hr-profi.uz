/** Shared helpers for the KPI hub. */
import type {
  KPIAssignmentStatus,
  KPICategory,
  RewardType,
} from "@/lib/types";

/** Same number format as the salary module — UZS-style 1 234 567. */
export function fmtMoney(n: number | string | null | undefined): string {
  if (n == null || n === "") return "—";
  const v = typeof n === "string" ? Number(n) : n;
  if (!Number.isFinite(v) || v === 0) return "—";
  return Math.round(v).toLocaleString("ru-RU").replace(/,/g, " ");
}

export function fmtMoneyZero(n: number | string | null | undefined): string {
  if (n == null || n === "") return "0";
  const v = typeof n === "string" ? Number(n) : n;
  if (!Number.isFinite(v)) return "0";
  return Math.round(v).toLocaleString("ru-RU").replace(/,/g, " ");
}

/** Score 0-100+ with two decimals. */
export function fmtScore(n: number | string | null | undefined): string {
  if (n == null || n === "") return "—";
  const v = typeof n === "string" ? Number(n) : n;
  if (!Number.isFinite(v)) return "—";
  return v.toFixed(2);
}

export function initialsOf(name: string | null | undefined): string {
  if (!name) return "•";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "•";
}

export function monthLabel(
  year: number,
  month: number,
  locale: string
): string {
  return new Date(year, month - 1, 1).toLocaleString(locale, {
    month: "long",
    year: "numeric",
  });
}

/** Visual tone (Tailwind utility set) per assignment status. */
export const STATUS_TONE: Record<
  KPIAssignmentStatus,
  { badge: "success" | "warning" | "danger" | "info" | "default"; bar: string }
> = {
  DRAFT: { badge: "default", bar: "bg-slate-300" },
  ACTIVE: { badge: "info", bar: "bg-sky-400" },
  COMPUTED: { badge: "info", bar: "bg-indigo-400" },
  APPROVED: { badge: "success", bar: "bg-emerald-400" },
  PAID: { badge: "success", bar: "bg-emerald-600" },
  REJECTED: { badge: "danger", bar: "bg-rose-500" },
  CANCELLED: { badge: "default", bar: "bg-slate-400" },
  COMPLETED: { badge: "success", bar: "bg-emerald-500" },
};

/** Color tone per score band — green ≥100, blue ≥80, amber ≥50, rose else. */
export function scoreTone(scoreStr: string | number | null | undefined): {
  bg: string;
  text: string;
  ring: string;
} {
  const s = typeof scoreStr === "number" ? scoreStr : Number(scoreStr ?? 0);
  if (!Number.isFinite(s)) return RING_SLATE;
  if (s >= 100) return RING_EMERALD;
  if (s >= 80) return RING_BRAND;
  if (s >= 50) return RING_AMBER;
  return RING_ROSE;
}

const RING_EMERALD = {
  bg: "bg-emerald-50",
  text: "text-emerald-700",
  ring: "ring-emerald-200",
};
const RING_BRAND = {
  bg: "bg-brand-50",
  text: "text-brand-700",
  ring: "ring-brand-200",
};
const RING_AMBER = {
  bg: "bg-amber-50",
  text: "text-amber-700",
  ring: "ring-amber-200",
};
const RING_ROSE = {
  bg: "bg-rose-50",
  text: "text-rose-700",
  ring: "ring-rose-200",
};
const RING_SLATE = {
  bg: "bg-slate-50",
  text: "text-slate-700",
  ring: "ring-slate-200",
};

export const CATEGORY_COLOR: Record<KPICategory, string> = {
  ATTENDANCE: "text-sky-700 bg-sky-50 ring-sky-200",
  SALES: "text-emerald-700 bg-emerald-50 ring-emerald-200",
  TASKS: "text-brand-700 bg-brand-50 ring-brand-200",
  QUALITY: "text-indigo-700 bg-indigo-50 ring-indigo-200",
  MANAGER_REVIEW: "text-amber-700 bg-amber-50 ring-amber-200",
  GOAL: "text-purple-700 bg-purple-50 ring-purple-200",
  CUSTOM: "text-slate-700 bg-slate-100 ring-slate-200",
};

export const REWARD_LABEL: Record<RewardType, string> = {
  FIXED: "$",
  PERCENT_OF_SALARY: "%",
  PER_UNIT: "×",
  TIERED: "▦",
  PENALTY_PERCENT: "↓%",
};
