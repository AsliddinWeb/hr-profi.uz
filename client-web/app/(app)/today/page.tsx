"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import axios from "axios";
import {
  Bell,
  CalendarDays,
  Calendar,
  Camera,
  ChevronRight,
  Clock,
  Coins,
  History,
  LogIn,
  LogOut,
  MapPin,
  Monitor,
  Moon,
  Sparkles,
  Sun,
  WifiOff,
} from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { getCurrentPosition } from "@/lib/geo";
import { cn } from "@/lib/cn";
import { fmtDuration, fmtMoneyZero } from "@/lib/format";
import { setThemeMode, useThemeMode, type ThemeMode } from "@/lib/theme";
import {
  enqueueCheckin,
  flushQueue,
  listQueued,
  type Mode as QueueMode,
  type QueuedCheckin,
} from "@/lib/offline-queue";
import type { AttendanceRecord, SalaryTodaySnapshot } from "@/lib/types";

import { SelfieCapture } from "@/components/SelfieCapture";
import { SystemClock } from "@/components/SystemClock";

function isNetworkError(e: unknown): boolean {
  if (axios.isAxiosError(e)) {
    // Axios sets `code === 'ERR_NETWORK'` when the request never made it to
    // a response (DNS fail, offline, CORS preflight blocked, etc).
    return (
      e.code === "ERR_NETWORK" ||
      e.code === "ECONNABORTED" ||
      typeof e.response === "undefined"
    );
  }
  return false;
}

async function postCheckin(kind: QueueMode, body: unknown) {
  const url = kind === "in" ? "/attendance/check-in" : "/attendance/check-out";
  return (await api.post<AttendanceRecord>(url, body)).data;
}

interface TodayStatus {
  first_check_in: string | null;
  last_check_out: string | null;
  is_working: boolean;
  minutes_worked_today: number;
  on_leave?: boolean;
  leave_type_name?: string | null;
  leave_end_date?: string | null;
  pwa_checkin_enabled?: boolean;
}

type Mode = "in" | "out";

function fmtTime(iso: string | null, locale: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

export default function TodayPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [captureMode, setCaptureMode] = useState<Mode | null>(null);

  const todayQ = useQuery({
    queryKey: ["attendance", "today"],
    queryFn: async () => (await api.get<TodayStatus>("/attendance/today")).data,
    refetchInterval: 60_000,
  });

  const historyQ = useQuery({
    queryKey: ["attendance", "history", "today"],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      return (
        await api.get<AttendanceRecord[]>("/attendance/history", {
          params: { from: today, to: today, limit: 20 },
        })
      ).data;
    },
    refetchInterval: 60_000,
  });

  // Today's accrual snapshot — drives the "earned today" tile in the hero.
  // Same key as the salary page query, so navigating between routes shares
  // the cached result instead of refetching.
  const salaryTodayQ = useQuery({
    queryKey: ["salary", "me", "today"],
    queryFn: async () =>
      (await api.get<SalaryTodaySnapshot>("/salary/me/today")).data,
    refetchInterval: 60_000,
  });

  const submitMut = useMutation({
    mutationFn: async ({
      mode,
      selfieBase64,
    }: {
      mode: Mode;
      selfieBase64: string;
    }) => {
      const pos = await getCurrentPosition();
      const body = {
        latitude: pos?.coords.latitude ?? null,
        longitude: pos?.coords.longitude ?? null,
        accuracy_m: pos?.coords.accuracy ?? null,
        selfie_base64: selfieBase64,
      };
      try {
        return await postCheckin(mode, body);
      } catch (e) {
        // Offline: stash the captured payload (selfie + GPS) and let the
        // background flusher replay it once we're back online.
        if (isNetworkError(e) || !navigator.onLine) {
          await enqueueCheckin({
            kind: mode,
            captured_at: new Date().toISOString(),
            latitude: body.latitude,
            longitude: body.longitude,
            accuracy_m: body.accuracy_m,
            selfie_base64: selfieBase64,
          });
          return { __queued: true, mode } as unknown as AttendanceRecord;
        }
        throw e;
      }
    },
    onSuccess: (rec, vars) => {
      qc.invalidateQueries({ queryKey: ["attendance"] });
      void refreshQueueCount();
      const queued = (rec as unknown as { __queued?: boolean })?.__queued;
      if (queued) {
        toast.success(t("today.queued_offline"));
      } else {
        toast.success(
          vars.mode === "in" ? t("today.success_in") : t("today.success_out")
        );
      }
    },
    onError: (e) => {
      // Most check-in errors are state mismatches: the user clicked
      // "Check in" while the server still has them as currently in
      // (409 attendance.already_checked_in), or vice versa. Force-refresh
      // the today snapshot so the button flips to the correct mode and
      // they don't have to manually reload.
      qc.invalidateQueries({ queryKey: ["attendance"] });
      toast.error(apiErrorMessage(e));
    },
  });

  // Keep a tiny on-screen counter of queued check-ins so the user knows
  // their offline taps weren't lost. Auto-refreshed when online events fire.
  const [queueCount, setQueueCount] = useState(0);
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const refreshQueueCount = async () => {
    try {
      const rows: QueuedCheckin[] = await listQueued();
      setQueueCount(rows.length);
    } catch {
      // IndexedDB unavailable (Safari private mode etc) — stay at 0.
    }
  };

  useEffect(() => {
    void refreshQueueCount();
    const onOnline = async () => {
      setOnline(true);
      const r = await flushQueue(postCheckin);
      await refreshQueueCount();
      if (r.ok > 0) {
        toast.success(t("today.queue_flushed", { count: r.ok }));
        qc.invalidateQueries({ queryKey: ["attendance"] });
      }
    };
    const onOffline = () => setOnline(false);
    const onSwMsg = (e: MessageEvent) => {
      if (e?.data?.type === "wtp.flush-queue" && navigator.onLine) {
        void onOnline();
      }
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", onSwMsg);
    }
    // Best-effort periodic flush in case the `online` event missed (some
    // browsers keep `online=true` even on captive portals).
    const iv = window.setInterval(() => {
      if (navigator.onLine) void onOnline();
    }, 60_000);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.removeEventListener("message", onSwMsg);
      }
      window.clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCaptured = (base64: string) => {
    if (!captureMode) return;
    submitMut.mutate({ mode: captureMode, selfieBase64: base64 });
    setCaptureMode(null);
  };

  const status = todayQ.data;
  const records = (historyQ.data ?? [])
    .slice()
    .sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  const isWorking = status?.is_working ?? false;
  const onLeave = status?.on_leave ?? false;
  // Mirrors the company's "Davomat usullari" → PWA toggle. Defaults to
  // true while the snapshot is loading so the button doesn't flash
  // hidden then back on. Only the actual ``false`` from the server
  // means "disabled".
  const pwaEnabled = status?.pwa_checkin_enabled !== false;
  const now = new Date();

  const unreadQ = useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: async () =>
      (await api.get<{ count: number }>("/notifications/unread-count")).data,
    refetchInterval: 60_000,
  });
  const unread = unreadQ.data?.count ?? 0;

  return (
    <div className="space-y-4">
      {/* Greeting */}
      <header className="flex items-center justify-between pt-2">
        <h1 className="text-xl font-bold text-slate-900">
          {t("today.title")}
        </h1>
        <div className="flex items-center gap-1">
          <span className="hidden text-xs tabular-nums text-slate-500 sm:inline">
            {now.toLocaleDateString(i18n.language, {
              weekday: "short",
              day: "2-digit",
              month: "short",
            })}
          </span>
          <SystemClock />
          <ThemeQuickToggle />
          <Link
            href="/notifications"
            aria-label={t("notifications.title")}
            className="relative rounded-full p-2 text-slate-600 hover:bg-slate-100"
          >
            <Bell className="size-5" />
            {unread > 0 && (
              <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </Link>
        </div>
      </header>

      {/* Status card — big colored hero based on current state */}
      <div
        className={cn(
          "relative overflow-hidden rounded-3xl p-5 shadow-sm transition",
          onLeave
            ? "bg-gradient-to-br from-indigo-500 to-indigo-700 text-white"
            : isWorking
              ? "bg-gradient-to-br from-emerald-500 to-emerald-700 text-white"
              : "bg-gradient-to-br from-slate-700 to-slate-900 text-white"
        )}
      >
        {/* Subtle pattern */}
        <div className="absolute -right-8 -top-8 size-40 rounded-full bg-white/10 blur-2xl" />
        <div className="relative">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider opacity-80">
            {onLeave ? (
              <>
                <CalendarDays className="size-3.5" />
                {t("today.on_leave_label")}
              </>
            ) : isWorking ? (
              <>
                <Sparkles className="size-3.5" />
                {t("today.still_in")}
              </>
            ) : (
              <Clock className="size-3.5" />
            )}
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-3xl font-bold">
              {user?.full_name || user?.username}
            </span>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
            <Tile
              label={t("today.first_check_in")}
              value={fmtTime(status?.first_check_in ?? null, i18n.language)}
              icon={<LogIn className="size-3" />}
            />
            <Tile
              label={t("today.last_check_out")}
              value={
                isWorking
                  ? "—"
                  : fmtTime(status?.last_check_out ?? null, i18n.language)
              }
              icon={<LogOut className="size-3" />}
            />
            <Tile
              label={t("today.worked_today")}
              value={fmtMinutes(status?.minutes_worked_today ?? 0)}
              icon={<Clock className="size-3" />}
            />
            <Tile
              label={t("today.earned_today")}
              value={fmtMoneyZero(salaryTodayQ.data?.today?.total_earned ?? 0)}
              icon={<Coins className="size-3" />}
            />
          </div>
        </div>
      </div>

      {/* Action: leave banner OR big primary button — switches by state */}
      {onLeave ? (
        <div className="flex items-start gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-indigo-900">
          <CalendarDays className="mt-0.5 size-5 shrink-0 text-indigo-600" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold">{t("today.on_leave_title")}</div>
            <div className="mt-0.5 text-xs text-indigo-800/80">
              {status?.leave_type_name ?? ""}
              {status?.leave_end_date && (
                <>
                  {status?.leave_type_name ? " · " : ""}
                  {t("today.on_leave_until", {
                    date: new Date(status.leave_end_date).toLocaleDateString(
                      i18n.language,
                      { day: "2-digit", month: "short", year: "numeric" }
                    ),
                  })}
                </>
              )}
            </div>
          </div>
        </div>
      ) : !pwaEnabled ? (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
          <Sparkles className="mt-0.5 size-5 shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold">{t("today.pwa_disabled_title")}</div>
            <div className="mt-0.5 text-xs text-amber-800/80">
              {t("today.pwa_disabled_hint")}
            </div>
          </div>
        </div>
      ) : isWorking ? (
        <button
          type="button"
          onClick={() => setCaptureMode("out")}
          disabled={submitMut.isPending}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-rose-600 px-4 py-5 text-base font-bold text-white shadow-lg shadow-rose-600/30 transition active:scale-[0.98] disabled:opacity-60"
        >
          <LogOut className="size-5" />
          {submitMut.isPending ? t("today.submitting") : t("today.check_out")}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setCaptureMode("in")}
          disabled={submitMut.isPending}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 px-4 py-5 text-base font-bold text-white shadow-lg shadow-brand-600/30 transition active:scale-[0.98] disabled:opacity-60"
        >
          <LogIn className="size-5" />
          {submitMut.isPending ? t("today.submitting") : t("today.check_in")}
        </button>
      )}

      {!onLeave && pwaEnabled && (
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-500">
          <Camera className="mr-1 inline size-3" /> {t("today.camera_required")}
          <br />
          <MapPin className="mr-1 inline size-3" /> {t("today.geofence_required")}
        </div>
      )}

      {(!online || queueCount > 0) && (
        <div
          className={cn(
            "flex items-start gap-2 rounded-xl border px-3 py-2 text-[11px]",
            !online
              ? "border-amber-200 bg-amber-50 text-amber-900"
              : "border-brand-200 bg-brand-50 text-brand-800"
          )}
        >
          <WifiOff className="mt-0.5 size-3 shrink-0" />
          <div>
            {!online && <div>{t("today.offline_mode")}</div>}
            {queueCount > 0 && (
              <div>{t("today.queued_count", { count: queueCount })}</div>
            )}
          </div>
        </div>
      )}

      {/* Today's records timeline */}
      <section className="card p-4">
        <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <Calendar className="size-3.5" />
          {t("today.show_today_records")}
          {records.length > 0 && (
            <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-[10px] tabular-nums text-slate-600">
              {records.length}
            </span>
          )}
        </div>
        {historyQ.isLoading ? (
          <p className="text-xs text-slate-500">{t("common.loading")}</p>
        ) : records.length === 0 ? (
          <p className="py-4 text-center text-xs text-slate-400">
            {t("today.no_records")}
          </p>
        ) : (
          <ol className="space-y-2">
            {records.map((r) => {
              const isIn = r.check_type === "CHECK_IN";
              return (
                <li
                  key={r.id}
                  className="flex items-start gap-3 rounded-lg border border-slate-100 bg-slate-50 p-2"
                >
                  <span
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-full text-white",
                      isIn ? "bg-emerald-500" : "bg-slate-500"
                    )}
                  >
                    {isIn ? (
                      <LogIn className="size-3.5" />
                    ) : (
                      <LogOut className="size-3.5" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-mono text-base font-bold tabular-nums text-slate-900">
                        {fmtTime(r.timestamp, i18n.language)}
                      </span>
                      <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold uppercase ring-1 ring-slate-200">
                        {isIn ? t("today.checked_in_at") : t("today.checked_out_at")}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                      {r.is_late && (
                        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800">
                          ⏰ {fmtDuration(r.late_minutes)} {t("today.tag_late")}
                        </span>
                      )}
                      {r.overtime_minutes > 0 && (
                        <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 font-semibold text-emerald-800">
                          ⏱ {fmtDuration(r.overtime_minutes)} {t("today.tag_overtime")}
                        </span>
                      )}
                      {r.status === "SUSPICIOUS" && (
                        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800">
                          ⚠ {t("today.tag_suspicious")}
                        </span>
                      )}
                      {r.latitude != null && (
                        <span className="inline-flex items-center gap-0.5">
                          <MapPin className="size-2.5" />
                          {Number(r.latitude).toFixed(4)},
                          {Number(r.longitude).toFixed(4)}
                        </span>
                      )}
                    </div>
                  </div>
                  {r.selfie_url && (
                    <a
                      href={r.selfie_url}
                      target="_blank"
                      rel="noreferrer"
                      className="block size-12 shrink-0 overflow-hidden rounded-lg ring-1 ring-slate-200"
                    >
                      <img
                        src={r.selfie_url}
                        alt=""
                        className="size-full object-cover"
                      />
                    </a>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* Quick links to History + Leaves — keeps the bottom-nav at 5 tabs */}
      <div className="grid grid-cols-2 gap-2">
        <Link
          href="/history"
          className="card flex items-center justify-between gap-2 p-3 transition active:scale-[0.99]"
        >
          <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-700">
            <History className="size-4 shrink-0 text-slate-500" />
            <span className="truncate">{t("history.title")}</span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-slate-400" />
        </Link>
        <Link
          href="/leaves"
          className="card flex items-center justify-between gap-2 p-3 transition active:scale-[0.99]"
        >
          <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-700">
            <CalendarDays className="size-4 shrink-0 text-brand-600" />
            <span className="truncate">{t("leaves.title")}</span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-slate-400" />
        </Link>
      </div>

      {captureMode && (
        <SelfieCapture
          onCapture={handleCaptured}
          onCancel={() => setCaptureMode(null)}
        />
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-white/15 px-2.5 py-2 backdrop-blur">
      <div className="flex items-center gap-1 text-[9px] uppercase opacity-80">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-0.5 font-mono text-base font-bold tabular-nums">
        {value}
      </div>
    </div>
  );
}

/**
 * One-tap theme cycle button (system → light → dark → system) for the
 * PWA topbar. We don't pop a menu here because the topbar is tight and
 * a tap-cycle is the lightweight pattern users expect on mobile.
 */
function ThemeQuickToggle() {
  const { t } = useTranslation();
  const mode = useThemeMode();
  const next: Record<ThemeMode, ThemeMode> = {
    system: "light",
    light: "dark",
    dark: "system",
  };
  const Icon =
    mode === "dark" ? Moon : mode === "light" ? Sun : Monitor;
  const label =
    mode === "dark"
      ? t("today.theme_dark")
      : mode === "light"
        ? t("today.theme_light")
        : t("today.theme_system");
  return (
    <button
      type="button"
      onClick={() => setThemeMode(next[mode])}
      aria-label={label}
      className="rounded-full p-2 text-slate-600 hover:bg-slate-100"
    >
      <Icon className="size-5" />
    </button>
  );
}
