// Tiny formatters tuned for the mobile dashboard. The backend returns
// Decimal values as strings, so we treat them as Number for display only.

export function formatMoney(value: string | number | null | undefined, suffix = ""): string {
  if (value == null) return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  // Group by spaces — UZS convention.
  const formatted = Math.round(n).toLocaleString("ru-RU").replace(/,/g, " ");
  return suffix ? `${formatted} ${suffix}` : formatted;
}

export function formatHoursFromMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0h 0m";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}h ${m}m`;
}

export function formatHoursFromDecimal(hoursStr: string | number | null | undefined): string {
  if (hoursStr == null) return "0h 0m";
  const hours = typeof hoursStr === "string" ? Number(hoursStr) : hoursStr;
  if (!Number.isFinite(hours)) return "0h 0m";
  const total = Math.round(hours * 60);
  return formatHoursFromMinutes(total);
}

export function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}
