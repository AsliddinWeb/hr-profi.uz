/** Format an integer-rounded sum number with Russian-locale thousand
 * separators (matches the rest of the app — UZS uses 1 234 567 style).
 * Returns em-dash for zero/null/non-finite. */
export function fmtMoney(n: number | string | null | undefined): string {
  if (n == null || n === "") return "—";
  const v = typeof n === "string" ? Number(n) : n;
  if (!Number.isFinite(v) || v === 0) return "—";
  return Math.round(v).toLocaleString("ru-RU").replace(/,/g, " ");
}

/** Same as fmtMoney but always returns a number string (used for totals
 * tiles where "0" is meaningful). */
export function fmtMoneyZero(n: number | string | null | undefined): string {
  if (n == null || n === "") return "0";
  const v = typeof n === "string" ? Number(n) : n;
  if (!Number.isFinite(v)) return "0";
  return Math.round(v).toLocaleString("ru-RU").replace(/,/g, " ");
}

/** 2-letter initials fallback when no avatar photo is set. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function monthLabel(year: number, month: number, locale: string): string {
  return new Date(year, month - 1, 1).toLocaleString(locale, {
    month: "long",
    year: "numeric",
  });
}
