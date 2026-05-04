import type { ShiftStatusLabel } from "@/lib/types";

/** Visual tone keyed off a shift_status label. Reused across the Live and
 * Records tabs so the colour vocabulary stays consistent. */
export function shiftStatusTone(s: ShiftStatusLabel): {
  badge: "success" | "warning" | "danger" | "info" | "default";
  ring: string;
} {
  switch (s) {
    case "IN_PROGRESS":
      return { badge: "info", ring: "ring-emerald-300" };
    case "PRESENT":
      return { badge: "success", ring: "ring-emerald-200" };
    case "LATE":
      return { badge: "warning", ring: "ring-amber-300" };
    case "ABSENT":
      return { badge: "danger", ring: "ring-rose-300" };
    case "ON_LEAVE":
      return { badge: "info", ring: "ring-indigo-300" };
    case "REST_DAY":
      return { badge: "default", ring: "ring-slate-200" };
    default:
      return { badge: "default", ring: "ring-slate-200" };
  }
}

/** Format hours from minutes — used in timetile cells. */
export function fmtHM(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0:00";
  const total = Math.floor(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

/** Compose the avatar initials when no photo is available. */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

/** Convert local-time HH:MM string to display, falling back to em-dash. */
export function fmtTime(iso: string | null, locale: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
}
