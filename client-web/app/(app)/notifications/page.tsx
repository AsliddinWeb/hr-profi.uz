"use client";

import { useEffect, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  AlertTriangle,
  Bell,
  BellOff,
  CalendarDays,
  CheckCheck,
  CircleDollarSign,
  Clock,
  Cpu,
  Inbox,
  Sparkles,
  Trash2,
  Trophy,
} from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  pushIsSubscribed,
  pushPermission,
  pushSupported,
  subscribePush,
  unsubscribePush,
} from "@/lib/push";
import type {
  NotificationCategory,
  NotificationItem,
  NotificationsPage,
} from "@/lib/types";

const CATEGORY_ICON: Record<NotificationCategory, React.ComponentType<{ className?: string }>> = {
  SYSTEM: Sparkles,
  ATTENDANCE: Clock,
  SALARY: CircleDollarSign,
  KPI: Trophy,
  LEAVE: CalendarDays,
  DEVICE: Cpu,
  ANOMALY: AlertTriangle,
};

const CATEGORY_TONE: Record<NotificationCategory, string> = {
  SYSTEM: "bg-slate-100 text-slate-700",
  ATTENDANCE: "bg-brand-100 text-brand-700",
  SALARY: "bg-emerald-100 text-emerald-700",
  KPI: "bg-indigo-100 text-indigo-700",
  LEAVE: "bg-sky-100 text-sky-700",
  DEVICE: "bg-amber-100 text-amber-800",
  ANOMALY: "bg-rose-100 text-rose-700",
};

function fmtRelative(iso: string, locale: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.round(diffMs / 60_000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h`;
  return new Date(iso).toLocaleDateString(locale, {
    day: "2-digit",
    month: "short",
  });
}

export default function NotificationsPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();

  const feedQ = useQuery({
    queryKey: ["notifications", "feed"],
    queryFn: async () =>
      (await api.get<NotificationsPage>("/notifications", {
        params: { page: 1, size: 100 },
      })).data,
    refetchInterval: 60_000,
  });

  const markReadMut = useMutation({
    mutationFn: async (id: string) =>
      (await api.post(`/notifications/${id}/read`)).data,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["notifications", "feed"] }),
  });

  const markAllMut = useMutation({
    mutationFn: async () => (await api.post("/notifications/read-all")).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications", "feed"] });
      toast.success(t("notifications.all_read_ok"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const clearReadMut = useMutation({
    mutationFn: async () =>
      (await api.delete("/notifications/clear-read")).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications", "feed"] });
      toast.success(t("notifications.cleared_ok"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const items = feedQ.data?.items ?? [];
  const unreadCount = items.filter((n) => !n.is_read).length;

  return (
    <div className="space-y-4">
      <header className="flex items-baseline justify-between pt-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            {t("notifications.title")}
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {t("notifications.subtitle", { count: unreadCount })}
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={() => markAllMut.mutate()}
            disabled={markAllMut.isPending}
            className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-3 py-1.5 text-xs font-bold text-brand-700 ring-1 ring-brand-200 disabled:opacity-50"
          >
            <CheckCheck className="size-3.5" />
            {t("notifications.mark_all_read")}
          </button>
        )}
      </header>

      <PushToggle />

      {feedQ.isLoading ? (
        <p className="py-8 text-center text-sm text-slate-500">
          {t("common.loading")}
        </p>
      ) : items.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 p-10 text-center">
          <Inbox className="size-8 text-slate-300" />
          <p className="text-sm font-medium text-slate-600">
            {t("notifications.empty")}
          </p>
        </div>
      ) : (
        <>
          <ul className="space-y-2">
            {items.map((n) => {
              const Icon = CATEGORY_ICON[n.category];
              return (
                <li
                  key={n.id}
                  className={cn(
                    "card relative flex items-start gap-3 p-3 transition",
                    !n.is_read && "bg-brand-50/50 ring-1 ring-brand-100"
                  )}
                >
                  <span
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-full",
                      CATEGORY_TONE[n.category]
                    )}
                  >
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <h3
                        className={cn(
                          "min-w-0 truncate text-sm",
                          n.is_read
                            ? "font-semibold text-slate-700"
                            : "font-bold text-slate-900"
                        )}
                      >
                        {translateNotif(t, n.title, n.payload, "title")}
                      </h3>
                      <span className="shrink-0 font-mono text-[10px] tabular-nums text-slate-400">
                        {fmtRelative(n.created_at, i18n.language)}
                      </span>
                    </div>
                    {(n.body || typeof n.payload?.body_key === "string") && (
                      <p className="mt-0.5 line-clamp-3 text-xs text-slate-600">
                        {translateNotif(t, n.body, n.payload, "body")}
                      </p>
                    )}
                    {!n.is_read && (
                      <button
                        type="button"
                        onClick={() => markReadMut.mutate(n.id)}
                        className="mt-1.5 text-[10px] font-semibold text-brand-700 hover:underline"
                      >
                        {t("notifications.mark_read")}
                      </button>
                    )}
                  </div>
                  {!n.is_read && (
                    <span className="absolute right-3 top-3 size-2 rounded-full bg-brand-600" />
                  )}
                </li>
              );
            })}
          </ul>

          <div className="pt-2">
            <button
              type="button"
              onClick={() => {
                if (
                  window.confirm(t("notifications.clear_read_confirm"))
                ) {
                  clearReadMut.mutate();
                }
              }}
              disabled={clearReadMut.isPending}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-rose-600 disabled:opacity-50"
            >
              <Trash2 className="size-3" />
              {t("notifications.clear_read")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function PushToggle() {
  const { t } = useTranslation();
  const [supported, setSupported] = useState<boolean>(true);
  const [permission, setPermission] = useState<string>("default");
  const [subscribed, setSubscribed] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);

  useEffect(() => {
    setSupported(pushSupported());
    setPermission(pushPermission());
    pushIsSubscribed().then(setSubscribed).catch(() => setSubscribed(false));
  }, []);

  if (!supported) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-500">
        <BellOff className="mr-1 inline size-3" />
        {t("notifications.push_unsupported")}
      </div>
    );
  }

  const enable = async () => {
    setBusy(true);
    try {
      const ok = await subscribePush();
      if (ok) {
        setSubscribed(true);
        setPermission(pushPermission());
        toast.success(t("notifications.push_enabled_ok"));
      } else {
        toast.error(t("notifications.push_blocked"));
      }
    } catch (e) {
      toast.error(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      await unsubscribePush();
      setSubscribed(false);
      toast.success(t("notifications.push_disabled_ok"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border p-3",
        subscribed
          ? "border-emerald-200 bg-emerald-50"
          : "border-slate-200 bg-white"
      )}
    >
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full",
          subscribed ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
        )}
      >
        {subscribed ? <Bell className="size-4" /> : <BellOff className="size-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold text-slate-900">
          {subscribed
            ? t("notifications.push_on_title")
            : t("notifications.push_off_title")}
        </div>
        <p className="mt-0.5 text-[11px] text-slate-500">
          {permission === "denied"
            ? t("notifications.push_denied_hint")
            : subscribed
              ? t("notifications.push_on_hint")
              : t("notifications.push_off_hint")}
        </p>
      </div>
      <button
        type="button"
        onClick={subscribed ? disable : enable}
        disabled={busy || permission === "denied"}
        className={cn(
          "shrink-0 rounded-full px-3 py-1.5 text-xs font-bold transition disabled:opacity-50",
          subscribed
            ? "bg-white text-slate-700 ring-1 ring-slate-200"
            : "bg-brand-600 text-white shadow-sm shadow-brand-600/30"
        )}
      >
        {busy
          ? "..."
          : subscribed
            ? t("notifications.push_disable")
            : t("notifications.push_enable")}
      </button>
    </div>
  );
}

/** Render an in-app notification's title/body.
 *
 * Two-layer resolution: modern path uses ``payload.{field}_key`` +
 * ``t_args``; legacy rows (English string, no keys) get pattern-matched
 * against the known backend templates so they translate too. Anything
 * we don't recognise falls back to the stored string verbatim.
 */
function translateNotif(
  t: (k: string, args?: Record<string, unknown>) => string,
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

function matchLegacyPattern(
  t: (k: string, args?: Record<string, unknown>) => string,
  raw: string,
  field: "title" | "body"
): string | null {
  if (!raw) return null;
  if (field === "title") {
    if (raw === "Out-of-geofence check-in") return t("anomaly.geofence_in.title");
    if (raw === "Out-of-geofence check-out") return t("anomaly.geofence_out.title");
    let m = /^Device offline:\s*(.+)$/.exec(raw);
    if (m) return t("anomaly.device_offline.title", { name: m[1] });
    m = /^New leave request:\s*(.+)$/.exec(raw);
    if (m) return t("leave.new_request.title", { name: m[1] });
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
