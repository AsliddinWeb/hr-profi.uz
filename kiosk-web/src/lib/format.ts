/** Compact "1h 30m" / "45m" out of an integer minutes count.
 * Kiosk uses this on late/overtime pills so a 130 min value reads as
 * "2h 10m" rather than "+130m". Always non-negative.  */
export function fmtDuration(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min)) return "—";
  const total = Math.max(0, Math.round(min));
  if (total < 60) return `${total}m`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
