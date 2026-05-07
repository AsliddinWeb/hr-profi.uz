/** UZS-style thousand-separated integer string. Returns "—" for nullish. */
export function fmtMoney(n: number | string | null | undefined): string {
  if (n == null || n === "") return "—";
  const v = typeof n === "string" ? Number(n) : n;
  if (!Number.isFinite(v) || v === 0) return "—";
  return Math.round(v).toLocaleString("ru-RU").replace(/,/g, " ");
}

/** Same as fmtMoney but returns "0" for zero (used in totals tiles). */
export function fmtMoneyZero(n: number | string | null | undefined): string {
  if (n == null || n === "") return "0";
  const v = typeof n === "string" ? Number(n) : n;
  if (!Number.isFinite(v)) return "0";
  return Math.round(v).toLocaleString("ru-RU").replace(/,/g, " ");
}

/** "HH:MM" out of an integer minutes count. */
export function fmtHM(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min)) return "—";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

/** Compact "1h 30m" / "45m" out of an integer minutes count. Used on
 * late/overtime pills so users don't have to mentally convert "+130m"
 * into "+2h 10m". Always non-negative. */
export function fmtDuration(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min)) return "—";
  const total = Math.max(0, Math.round(min));
  if (total < 60) return `${total}m`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** "HH:MM" out of a backend ``time`` string ("09:00:00" → "09:00"). */
export function fmtTime(t: string | null | undefined): string {
  if (!t) return "—";
  return t.slice(0, 5);
}

/** Localised "May 3" date out of an ISO date or datetime string. */
export function fmtShortDate(iso: string | null, locale: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(locale, {
    day: "2-digit",
    month: "short",
  });
}

/** Locale-aware "May 2026". */
export function fmtMonthLabel(year: number, month: number, locale: string): string {
  return new Date(year, month - 1, 1).toLocaleString(locale, {
    month: "long",
    year: "numeric",
  });
}
