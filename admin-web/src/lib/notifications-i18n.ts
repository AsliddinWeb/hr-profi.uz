/**
 * Notification text translation.
 *
 * Notifications get stored on the server with two redundant fields:
 *   - the rendered ``title`` / ``body`` string (English fallback)
 *   - a structured ``payload`` carrying ``title_key`` + ``body_key`` + ``t_args``
 *
 * The legacy English titles ("Out-of-geofence check-in", "Device offline:
 * X", …) live in old DB rows from before we added the i18n payload, plus
 * a few code paths that still emit raw English. The translator below
 * tries the modern path first, then a regex matcher against the raw text
 * so historical rows still localise correctly.
 *
 * Used by NotificationsPage (full list) and NotificationBell (dropdown)
 * — keep the implementations identical so users see the same string in
 * both places.
 */
type T = (k: string, args?: Record<string, unknown>) => string;

export function translateNotification(
  t: T,
  fallback: string | null | undefined,
  payload: Record<string, unknown> | null | undefined,
  field: "title" | "body"
): string {
  const key = payload?.[`${field}_key`];
  if (typeof key === "string" && key) {
    const args = (payload?.t_args as Record<string, unknown>) || {};
    const translated = t(key, args);
    if (translated !== key) return translated;
  }
  return matchLegacyPattern(t, fallback || "", field) || fallback || "";
}

/** Best-effort English-pattern → translated-string. Returns ``null`` when
 * no pattern matched so the caller knows to keep the original. */
function matchLegacyPattern(
  t: T,
  raw: string,
  field: "title" | "body"
): string | null {
  if (!raw) return null;

  if (field === "title") {
    if (raw === "Out-of-geofence check-in") {
      return t("anomaly.geofence_in.title");
    }
    if (raw === "Out-of-geofence check-out") {
      return t("anomaly.geofence_out.title");
    }

    let m = /^Device offline:\s*(.+)$/.exec(raw);
    if (m) return t("anomaly.device_offline.title", { name: m[1] });

    m = /^New leave request:\s*(.+)$/.exec(raw);
    if (m) return t("leave.new_request.title", { name: m[1] });

    m = /^Suspicious face match:\s*(.+)$/.exec(raw);
    if (m) return t("anomaly.suspicious_face.title", { code: m[1] });
  }

  if (field === "body") {
    let m = /^(.+?) checked in outside the branch radius\.?$/.exec(raw);
    if (m) return t("anomaly.geofence_in.body", { name: m[1] });

    m = /^(.+?) checked out outside the branch radius\.?$/.exec(raw);
    if (m) return t("anomaly.geofence_out.body", { name: m[1] });

    m = /^Last seen at\s*(.+)$/.exec(raw);
    if (m) return t("anomaly.device_offline.body", { last_seen: m[1] });
  }
  return null;
}
