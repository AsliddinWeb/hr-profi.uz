import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  AlertTriangle,
  Bell,
  CalendarDays,
  CheckCheck,
  Clock,
  Coins,
  Cpu,
  Eraser,
  ListChecks,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  Trash2,
  Trophy,
  Wifi,
} from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/PageHeader";
import { useNotificationsStore } from "@/stores/notifications";
import { useEnumLabel } from "@/lib/enum";
import { cn } from "@/lib/cn";
import type {
  AppNotification,
  NotificationCategory,
  Page,
} from "@/lib/types";

type ReadFilter = "all" | "unread" | "read";

const CATS: NotificationCategory[] = [
  "SYSTEM",
  "ATTENDANCE",
  "SALARY",
  "KPI",
  "LEAVE",
  "DEVICE",
  "ANOMALY",
];

const CAT_ICON: Record<NotificationCategory, React.ComponentType<{ className?: string }>> = {
  SYSTEM: SettingsIcon,
  ATTENDANCE: Clock,
  SALARY: Coins,
  KPI: Trophy,
  LEAVE: CalendarDays,
  DEVICE: Cpu,
  ANOMALY: AlertTriangle,
};

const CAT_TONE: Record<
  NotificationCategory,
  { bg: string; text: string; ring: string; bar: string }
> = {
  SYSTEM: {
    bg: "bg-slate-50",
    text: "text-slate-700",
    ring: "ring-slate-200",
    bar: "bg-slate-400",
  },
  ATTENDANCE: {
    bg: "bg-sky-50",
    text: "text-sky-700",
    ring: "ring-sky-200",
    bar: "bg-sky-500",
  },
  SALARY: {
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    ring: "ring-emerald-200",
    bar: "bg-emerald-500",
  },
  KPI: {
    bg: "bg-brand-50",
    text: "text-brand-700",
    ring: "ring-brand-200",
    bar: "bg-brand-500",
  },
  LEAVE: {
    bg: "bg-indigo-50",
    text: "text-indigo-700",
    ring: "ring-indigo-200",
    bar: "bg-indigo-500",
  },
  DEVICE: {
    bg: "bg-amber-50",
    text: "text-amber-700",
    ring: "ring-amber-200",
    bar: "bg-amber-500",
  },
  ANOMALY: {
    bg: "bg-rose-50",
    text: "text-rose-700",
    ring: "ring-rose-200",
    bar: "bg-rose-500",
  },
};

export function NotificationsPage() {
  const { t, i18n } = useTranslation();
  const label = useEnumLabel();
  const nav = useNavigate();
  const qc = useQueryClient();
  const refreshStore = useNotificationsStore((s) => s.fetch);

  const [readFilter, setReadFilter] = useState<ReadFilter>("all");
  const [catFilter, setCatFilter] = useState<NotificationCategory | "all">(
    "all"
  );
  const [query, setQuery] = useState("");

  const listQ = useQuery({
    queryKey: ["notifications", "feed", readFilter, catFilter],
    queryFn: async () => {
      const params: Record<string, string | number | boolean> = { size: 100 };
      if (readFilter === "unread") params.unread = true;
      if (readFilter === "read") params.unread = false;
      if (catFilter !== "all") params.category = catFilter;
      return (
        await api.get<Page<AppNotification>>("/notifications", { params })
      ).data;
    },
    refetchInterval: 30_000,
  });

  // When the user toggles the in-page mark-read, also bump the bell count.
  useEffect(() => {
    refreshStore();
  }, [listQ.data, refreshStore]);

  const markReadMut = useMutation({
    mutationFn: async (id: string) =>
      api.post(`/notifications/${id}/read`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      refreshStore();
    },
  });

  const markAllReadMut = useMutation({
    mutationFn: async () => api.post("/notifications/read-all"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      refreshStore();
      toast.success(t("notifications_page.mark_all_done"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const deleteOneMut = useMutation({
    mutationFn: async (id: string) => api.delete(`/notifications/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      refreshStore();
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const clearReadMut = useMutation({
    mutationFn: async () => api.delete("/notifications/clear-read"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      refreshStore();
      toast.success(t("notifications_page.cleared_done"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const items = listQ.data?.items ?? [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        (n.body ?? "").toLowerCase().includes(q)
    );
  }, [items, query]);

  const stats = useMemo(() => {
    const out = { unread: 0, byCat: {} as Record<string, number> };
    for (const n of items) {
      if (!n.is_read) out.unread += 1;
      out.byCat[n.category] = (out.byCat[n.category] ?? 0) + 1;
    }
    return out;
  }, [items]);

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("notifications_page.title")}
        breadcrumbs={[{ label: t("notifications_page.title") }]}
        icon={<Bell className="size-5" />}
        description={t("notifications_page.subtitle")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => nav("/app/settings?tab=notifications")}
            >
              <SettingsIcon className="size-4" />
              {t("notifications_page.preferences")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => markAllReadMut.mutate()}
              disabled={stats.unread === 0}
              loading={markAllReadMut.isPending}
            >
              <CheckCheck className="size-4" />
              {t("notifications_page.mark_all_read")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                if (
                  window.confirm(t("notifications_page.clear_read_confirm") ?? "")
                ) {
                  clearReadMut.mutate();
                }
              }}
              loading={clearReadMut.isPending}
            >
              <Eraser className="size-4" />
              {t("notifications_page.clear_read")}
            </Button>
          </div>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Chip
          active={readFilter === "all"}
          onClick={() => setReadFilter("all")}
          label={t("notifications_page.filter_all")}
          icon={<ListChecks className="size-3.5" />}
        />
        <Chip
          active={readFilter === "unread"}
          onClick={() => setReadFilter("unread")}
          label={`${t("notifications_page.filter_unread")} ${stats.unread > 0 ? `(${stats.unread})` : ""}`}
          icon={<Bell className="size-3.5" />}
        />
        <Chip
          active={readFilter === "read"}
          onClick={() => setReadFilter("read")}
          label={t("notifications_page.filter_read")}
          icon={<CheckCheck className="size-3.5" />}
        />

        <span className="mx-2 hidden h-6 w-px bg-slate-200 sm:inline-block" />

        <Chip
          active={catFilter === "all"}
          onClick={() => setCatFilter("all")}
          label={t("notifications_page.cat_all")}
          icon={<ListChecks className="size-3.5" />}
        />
        {CATS.map((c) => {
          const Icon = CAT_ICON[c];
          return (
            <Chip
              key={c}
              active={catFilter === c}
              onClick={() => setCatFilter(c)}
              label={`${label("notification_category", c)}${stats.byCat[c] ? ` (${stats.byCat[c]})` : ""}`}
              icon={<Icon className="size-3.5" />}
            />
          );
        })}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[280px] flex-1">
          <Input
            label={t("notifications_page.search_label")}
            placeholder={t("notifications_page.search_placeholder") ?? ""}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            prefix={<Search className="size-4" />}
          />
        </div>
        <div className="ml-auto">
          <Button
            variant="secondary"
            onClick={() => listQ.refetch()}
            loading={listQ.isFetching}
          >
            <RefreshCw className="size-4" />
            {t("attendance.refresh")}
          </Button>
        </div>
      </div>

      {/* Feed */}
      {listQ.isLoading ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          {t("common.loading")}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 bg-white p-12 text-center">
          <Bell className="mx-auto mb-2 size-8 text-slate-300" />
          <p className="text-sm font-medium text-slate-600">
            {t("notifications_page.empty")}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            {t("notifications_page.empty_hint")}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((n) => {
            const Icon = CAT_ICON[n.category];
            const tone = CAT_TONE[n.category];
            return (
              <li
                key={n.id}
                className={cn(
                  "group flex gap-3 overflow-hidden rounded-lg border bg-white p-3 transition hover:shadow-sm",
                  n.is_read
                    ? "border-slate-200"
                    : "border-brand-200 bg-brand-50/30 ring-1 ring-brand-100"
                )}
              >
                {/* Left accent stripe */}
                <span
                  className={cn(
                    "-my-3 -ml-3 w-1 shrink-0",
                    tone.bar,
                    n.is_read && "opacity-50"
                  )}
                />
                {/* Icon */}
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-full ring-1",
                    tone.bg,
                    tone.text,
                    tone.ring
                  )}
                >
                  <Icon className="size-4" />
                </span>
                {/* Body */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span
                      className={cn(
                        "text-sm",
                        n.is_read
                          ? "text-slate-700"
                          : "font-semibold text-slate-900"
                      )}
                    >
                      {translateNotification(t, n.title, n.payload, "title")}
                    </span>
                    <Badge
                      tone={
                        n.category === "ANOMALY"
                          ? "danger"
                          : n.category === "DEVICE"
                            ? "warning"
                            : n.category === "SALARY" || n.category === "KPI"
                              ? "success"
                              : "info"
                      }
                    >
                      {label("notification_category", n.category)}
                    </Badge>
                  </div>
                  {(n.body || typeof n.payload?.body_key === "string") && (
                    <p className="mt-0.5 text-xs text-slate-600">
                      {translateNotification(t, n.body, n.payload, "body")}
                    </p>
                  )}
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-400">
                    <Wifi className="size-3 opacity-50" />
                    <span>
                      {new Date(n.created_at).toLocaleString(i18n.language)}
                    </span>
                    {n.read_at && (
                      <span>
                        ·{" "}
                        {t("notifications_page.read_at_label")}{" "}
                        {new Date(n.read_at).toLocaleString(i18n.language)}
                      </span>
                    )}
                  </div>
                </div>
                {/* Actions */}
                <div className="flex shrink-0 items-start gap-1 opacity-0 transition group-hover:opacity-100">
                  {!n.is_read && (
                    <button
                      type="button"
                      onClick={() => markReadMut.mutate(n.id)}
                      className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                      title={t("notifications_page.mark_read") ?? undefined}
                    >
                      <CheckCheck className="size-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => deleteOneMut.mutate(n.id)}
                    className="rounded-md p-1.5 text-rose-500 hover:bg-rose-50"
                    title={t("notifications_page.delete") ?? undefined}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Chip({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition",
        active
          ? "border-brand-600 bg-brand-600 text-white shadow-sm shadow-brand-600/30"
          : "border-slate-200 bg-white text-slate-700 hover:border-brand-300 hover:bg-brand-50/50"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/**
 * Localise an in-app notification.
 *
 * Two layers of resolution:
 * 1. Modern path — backend stored ``title_key`` / ``body_key`` +
 *    ``t_args`` in the payload. Direct i18n lookup.
 * 2. Legacy path — older rows hold an English string and no keys. We
 *    pattern-match the most common backend templates ("Out-of-geofence
 *    check-in", "Device offline: X", "New leave request: X") and
 *    translate them. Anything we don't recognise falls through to the
 *    stored text unchanged so we never lose information.
 */
function translateNotification(
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

/** Best-effort English-pattern → translated-string. Returns ``null``
 * when no pattern matched so the caller knows to show the original. */
function matchLegacyPattern(
  t: (k: string, args?: Record<string, unknown>) => string,
  raw: string,
  field: "title" | "body"
): string | null {
  if (!raw) return null;

  if (field === "title") {
    if (raw === "Out-of-geofence check-in") {
      // Body of these alerts has the employee name; without it we render
      // the title with an empty placeholder which still reads better
      // than the original English.
      return t("anomaly.geofence_in.title");
    }
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
