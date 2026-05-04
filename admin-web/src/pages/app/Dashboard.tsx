import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Building2,
  CalendarDays,
  CheckCheck,
  Clock,
  ClipboardCheck,
  Coins,
  Cpu,
  HandCoins,
  Layers,
  ListChecks,
  LogIn,
  PowerOff,
  Sparkles,
  Store,
  TrendingUp,
  Trophy,
  UserX,
  Users,
  Wallet,
  Wifi,
  WifiOff,
} from "lucide-react";

import { api } from "@/lib/api";
import { Avatar } from "@/components/ui/Avatar";
import { Card, CardSubtitle, CardTitle } from "@/components/ui/Card";
import { PageHeader } from "@/components/PageHeader";
import { SystemClock } from "@/components/SystemClock";
import { adminWS } from "@/lib/ws";
import { useAuthStore } from "@/stores/auth";
import { cn } from "@/lib/cn";
import type { DashboardSummary } from "@/lib/types";

const QUICK_LINKS = [
  { to: "/app/employees", icon: Users, key: "nav.employees" },
  { to: "/app/attendance", icon: ClipboardCheck, key: "nav.attendance" },
  { to: "/app/salary", icon: Coins, key: "nav.salary" },
  { to: "/app/kpi", icon: Trophy, key: "nav.kpi" },
  { to: "/app/leaves", icon: CalendarDays, key: "nav.leaves" },
  { to: "/app/shifts", icon: Layers, key: "nav.shifts" },
  { to: "/app/branches", icon: Store, key: "nav.branches" },
  { to: "/app/devices", icon: Cpu, key: "nav.devices" },
] as const;

function fmtMoneyCompact(n: string | number | null | undefined): string {
  if (n == null || n === "") return "0";
  const v = typeof n === "string" ? Number(n) : n;
  if (!Number.isFinite(v)) return "0";
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return Math.round(v).toLocaleString("ru-RU").replace(/,/g, " ");
}

function fmtMoneyFull(n: string | number | null | undefined): string {
  if (n == null || n === "") return "0";
  const v = typeof n === "string" ? Number(n) : n;
  if (!Number.isFinite(v)) return "0";
  return Math.round(v).toLocaleString("ru-RU").replace(/,/g, " ");
}

export function AppDashboard() {
  const { t, i18n } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();

  const summaryQ = useQuery({
    queryKey: ["dashboard", "summary"],
    queryFn: async () =>
      (await api.get<DashboardSummary>("/dashboard/summary")).data,
    refetchInterval: 60_000,
    staleTime: 0,
  });

  // Live updates: when an attendance/salary/kpi/leave WS event lands, refetch
  // so the cards stay in sync without waiting for the 60s tick.
  useEffect(() => {
    const refresh = () =>
      qc.invalidateQueries({ queryKey: ["dashboard", "summary"] });
    const events = [
      "salary_updated",
      "kpi_score_updated",
      "leave_status_changed",
      "anomaly_detected",
      "notification_new",
    ];
    const unsubs = events.map((e) => adminWS.on(e, refresh));
    return () => {
      unsubs.forEach((u) => u());
    };
  }, [qc]);

  const s = summaryQ.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span>
            {t("dashboard.greeting")},{" "}
            <span className="text-brand-700">
              {user?.full_name || user?.username}
            </span>
          </span>
        }
        description={t("dashboard.subtitle")}
        breadcrumbs={[{ label: t("nav.dashboard") }]}
        actions={<SystemClock />}
      />

      {summaryQ.isLoading || !s ? (
        <p className="text-sm text-slate-500">{t("common.loading")}</p>
      ) : (
        <>
          {/* Top-level counts */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatTile
              tone="brand"
              icon={<Users className="size-4" />}
              label={t("dashboard.tile_employees")}
              value={s.counts.employees_active}
              hint={`/ ${s.counts.employees_total} ${t("dashboard.tile_total")}`}
              to="/app/employees"
            />
            <StatTile
              tone="sky"
              icon={<Building2 className="size-4" />}
              label={t("dashboard.tile_branches")}
              value={s.counts.branches}
              hint={`${s.counts.departments} ${t("dashboard.tile_departments")}`}
              to="/app/branches"
            />
            <StatTile
              tone="emerald"
              icon={<Cpu className="size-4" />}
              label={t("dashboard.tile_devices")}
              value={s.counts.devices_total}
              hint={
                <span className="inline-flex items-center gap-2">
                  <span className="inline-flex items-center gap-0.5 text-emerald-700">
                    <Wifi className="size-3" /> {s.counts.devices_online}
                  </span>
                  <span className="inline-flex items-center gap-0.5 text-rose-700">
                    <WifiOff className="size-3" /> {s.counts.devices_offline}
                  </span>
                </span>
              }
              to="/app/devices"
            />
            <StatTile
              tone="amber"
              icon={<CalendarDays className="size-4" />}
              label={t("dashboard.tile_leaves_pending")}
              value={s.leaves.pending_count}
              hint={`${s.leaves.approved_this_month} ${t("dashboard.tile_approved_short")}`}
              to="/app/leaves"
            />
            <StatTile
              tone="rose"
              icon={<AlertTriangle className="size-4" />}
              label={t("dashboard.tile_kpi_pending")}
              value={s.kpi.pending_approvals}
              hint={t("dashboard.tile_kpi_pending_hint")}
              to="/app/kpi?tab=assignments"
            />
          </div>

          {/* Today attendance + salary cards row */}
          <div className="grid gap-4 lg:grid-cols-3">
            {/* Today attendance card */}
            <Card>
              <div className="card-header flex items-center justify-between">
                <div>
                  <CardTitle>{t("dashboard.today_attendance")}</CardTitle>
                  <CardSubtitle>{t("dashboard.today_attendance_hint")}</CardSubtitle>
                </div>
                <Link
                  to="/app/attendance"
                  className="text-xs font-semibold text-brand-700 hover:underline"
                >
                  {t("dashboard.open")}
                </Link>
              </div>
              <div className="card-body grid grid-cols-3 gap-2">
                <MiniTile
                  tone="emerald"
                  icon={<LogIn className="size-3.5" />}
                  label={t("dashboard.attendance_present")}
                  value={s.attendance.present_today}
                />
                <MiniTile
                  tone="amber"
                  icon={<Clock className="size-3.5" />}
                  label={t("dashboard.attendance_late")}
                  value={s.attendance.late_today}
                />
                <MiniTile
                  tone="rose"
                  icon={<UserX className="size-3.5" />}
                  label={t("dashboard.attendance_absent")}
                  value={s.attendance.absent_today}
                />
                <MiniTile
                  tone="indigo"
                  icon={<PowerOff className="size-3.5" />}
                  label={t("dashboard.attendance_rest")}
                  value={s.attendance.rest_today}
                />
                <MiniTile
                  tone="sky"
                  icon={<Sparkles className="size-3.5" />}
                  label={t("dashboard.attendance_working_now")}
                  value={s.attendance.currently_working}
                  pulse
                />
                <MiniTile
                  tone="emerald"
                  icon={<TrendingUp className="size-3.5" />}
                  label={t("dashboard.attendance_overtime")}
                  value={`${Math.round(s.attendance.overtime_minutes_today / 60)}h`}
                />
              </div>
            </Card>

            {/* Salary this month */}
            <Card>
              <div className="card-header flex items-center justify-between">
                <div>
                  <CardTitle>{t("dashboard.salary_this_month")}</CardTitle>
                  <CardSubtitle>
                    {monthName(s.salary.year, s.salary.month, i18n.language)}
                  </CardSubtitle>
                </div>
                <Link
                  to="/app/salary"
                  className="text-xs font-semibold text-brand-700 hover:underline"
                >
                  {t("dashboard.open")}
                </Link>
              </div>
              <div className="card-body space-y-3">
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <Money
                    tone="brand"
                    icon={<Coins className="size-3.5" />}
                    label={t("dashboard.total_earned")}
                    value={fmtMoneyCompact(s.salary.total_earned)}
                  />
                  <Money
                    tone="emerald"
                    icon={<CheckCheck className="size-3.5" />}
                    label={t("dashboard.total_paid")}
                    value={fmtMoneyCompact(s.salary.total_paid)}
                  />
                  <Money
                    tone="amber"
                    icon={<Wallet className="size-3.5" />}
                    label={t("dashboard.total_pending")}
                    value={fmtMoneyCompact(s.salary.total_pending)}
                  />
                </div>
                {Number(s.salary.advances_outstanding) > 0 && (
                  <div className="flex items-center gap-2 rounded-md bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
                    <HandCoins className="size-3.5" />
                    <span>
                      {t("dashboard.advances_outstanding")}:{" "}
                      <strong className="tabular-nums">
                        {fmtMoneyFull(s.salary.advances_outstanding)}
                      </strong>
                    </span>
                  </div>
                )}
                {/* Progress bar: paid vs total */}
                <div>
                  <div className="flex items-baseline justify-between text-[10px] text-slate-500">
                    <span>{t("dashboard.payout_progress")}</span>
                    <span className="tabular-nums">
                      {Number(s.salary.total_earned) > 0
                        ? Math.round(
                            (Number(s.salary.total_paid) /
                              Number(s.salary.total_earned)) *
                              100
                          )
                        : 0}
                      %
                    </span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{
                        width: `${Number(s.salary.total_earned) > 0 ? Math.min(100, (Number(s.salary.total_paid) / Number(s.salary.total_earned)) * 100) : 0}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            </Card>

            {/* KPI this month */}
            <Card>
              <div className="card-header flex items-center justify-between">
                <div>
                  <CardTitle>{t("dashboard.kpi_this_month")}</CardTitle>
                  <CardSubtitle>
                    {monthName(s.kpi.year, s.kpi.month, i18n.language)}
                  </CardSubtitle>
                </div>
                <Link
                  to="/app/kpi"
                  className="text-xs font-semibold text-brand-700 hover:underline"
                >
                  {t("dashboard.open")}
                </Link>
              </div>
              <div className="card-body space-y-3">
                <div className="rounded-xl bg-gradient-to-br from-brand-50 to-brand-100 p-4 text-center">
                  <div className="text-[10px] uppercase tracking-wide text-brand-700/70">
                    {t("dashboard.kpi_avg_score")}
                  </div>
                  <div className="text-3xl font-bold tabular-nums text-brand-800">
                    {Number(s.kpi.avg_score).toFixed(1)}%
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <Money
                    tone="emerald"
                    icon={<Trophy className="size-3.5" />}
                    label={t("dashboard.kpi_total_reward")}
                    value={fmtMoneyCompact(s.kpi.total_reward)}
                  />
                  <MiniTile
                    tone="amber"
                    icon={<AlertTriangle className="size-3.5" />}
                    label={t("dashboard.kpi_pending")}
                    value={s.kpi.pending_approvals}
                  />
                </div>
              </div>
            </Card>
          </div>

          {/* Attendance trend chart + Recent activity */}
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <div className="card-header flex items-center justify-between">
                <div>
                  <CardTitle>{t("dashboard.attendance_trend")}</CardTitle>
                  <CardSubtitle>
                    {t("dashboard.attendance_trend_hint", {
                      days: s.attendance_trend.length,
                    })}
                  </CardSubtitle>
                </div>
              </div>
              <div className="card-body">
                <TrendChart points={s.attendance_trend} />
              </div>
            </Card>

            <Card>
              <div className="card-header flex items-center justify-between">
                <div>
                  <CardTitle>{t("dashboard.recent_activity")}</CardTitle>
                  <CardSubtitle>{t("dashboard.recent_activity_hint")}</CardSubtitle>
                </div>
              </div>
              <div className="card-body">
                {s.recent_activity.length === 0 ? (
                  <p className="py-6 text-center text-xs text-slate-400">
                    {t("dashboard.recent_empty")}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {s.recent_activity.slice(0, 12).map((a, i) => (
                      <ActivityRow key={`${a.at}-${i}`} item={a} />
                    ))}
                  </ul>
                )}
              </div>
            </Card>
          </div>

          {/* Quick links + Profile */}
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <div className="card-header">
                <div>
                  <CardTitle>{t("dashboard.quick_links")}</CardTitle>
                  <CardSubtitle>{t("dashboard.quick_links_hint")}</CardSubtitle>
                </div>
              </div>
              <div className="card-body grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {QUICK_LINKS.map(({ to, icon: Icon, key }) => (
                  <Link
                    key={to}
                    to={to}
                    className="group flex items-center gap-2 rounded-xl border border-[var(--card-border)] p-2.5 transition-colors hover:border-brand-200 hover:bg-brand-50/40"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 group-hover:bg-brand-100">
                      <Icon className="size-4" />
                    </span>
                    <span className="text-xs font-medium text-ink-900">
                      {t(key)}
                    </span>
                  </Link>
                ))}
              </div>
            </Card>

            <Card>
              <div className="card-body">
                <div className="flex items-center gap-3">
                  <Avatar name={user?.full_name || user?.username} size="lg" />
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold text-ink-900">
                      {user?.full_name || user?.username}
                    </p>
                    <p className="text-xs text-ink-500">{user?.role}</p>
                  </div>
                </div>
                <dl className="mt-4 space-y-2 text-sm">
                  <Row label={t("users.username")} value={`@${user?.username}`} />
                  <Row label={t("users.email")} value={user?.email ?? "—"} />
                  <Row
                    label={t("users.language")}
                    value={(user?.language ?? "uz").toUpperCase()}
                  />
                </dl>
                <div className="mt-3 flex gap-2">
                  <Link
                    to="/app/settings?tab=profile"
                    className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-center text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    {t("dashboard.edit_profile")}
                  </Link>
                  <Link
                    to="/app/notifications"
                    className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-center text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <ListChecks className="mr-1 inline size-3" />
                    {t("dashboard.notifications")}
                  </Link>
                </div>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function StatTile({
  tone,
  icon,
  label,
  value,
  hint,
  to,
}: {
  tone: "brand" | "sky" | "emerald" | "amber" | "rose";
  icon: React.ReactNode;
  label: string;
  value: number | string;
  hint?: React.ReactNode;
  to?: string;
}) {
  const cls = {
    brand: "border-brand-200 bg-brand-50 text-brand-800",
    sky: "border-sky-200 bg-sky-50 text-sky-800",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    rose: "border-rose-200 bg-rose-50 text-rose-800",
  }[tone];
  const inner = (
    <div className={cn("rounded-lg border px-3 py-2.5 transition", cls, to && "hover:scale-[1.02]")}>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide opacity-70">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums leading-none">
        {value}
      </div>
      {hint && (
        <div className="mt-1 text-[10px] opacity-70">{hint}</div>
      )}
    </div>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
}

function MiniTile({
  tone,
  icon,
  label,
  value,
  pulse,
}: {
  tone: "emerald" | "amber" | "rose" | "indigo" | "sky" | "brand";
  icon: React.ReactNode;
  label: string;
  value: number | string;
  pulse?: boolean;
}) {
  const cls = {
    emerald: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    amber: "bg-amber-50 text-amber-800 ring-amber-200",
    rose: "bg-rose-50 text-rose-800 ring-rose-200",
    indigo: "bg-indigo-50 text-indigo-800 ring-indigo-200",
    sky: "bg-sky-50 text-sky-800 ring-sky-200",
    brand: "bg-brand-50 text-brand-800 ring-brand-200",
  }[tone];
  return (
    <div className={cn("relative rounded-md px-2 py-1.5 ring-1", cls)}>
      {pulse && (
        <span className="absolute right-1 top-1 size-1.5 animate-pulse rounded-full bg-emerald-500" />
      )}
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-wide opacity-70">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 text-base font-bold tabular-nums leading-tight">
        {value}
      </div>
    </div>
  );
}

function Money({
  tone,
  icon,
  label,
  value,
}: {
  tone: "brand" | "emerald" | "amber" | "indigo";
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  const cls = {
    brand: "bg-brand-50 text-brand-800 ring-brand-200",
    emerald: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    amber: "bg-amber-50 text-amber-800 ring-amber-200",
    indigo: "bg-indigo-50 text-indigo-800 ring-indigo-200",
  }[tone];
  return (
    <div className={cn("rounded-md px-2 py-1.5 ring-1", cls)}>
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-wide opacity-70">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 text-base font-bold tabular-nums leading-tight">
        {value}
      </div>
    </div>
  );
}

function TrendChart({
  points,
}: {
  points: { day: string; present: number; late: number; absent: number }[];
}) {
  const max = Math.max(
    1,
    ...points.map((p) => Math.max(p.present, p.absent, p.late))
  );
  return (
    <div className="flex items-end gap-1.5 overflow-x-auto pb-1">
      {points.map((p) => {
        const h = (n: number) => Math.max(2, (n / max) * 110);
        return (
          <div
            key={p.day}
            className="flex min-w-[36px] flex-col items-center gap-1"
            title={`${p.day}: ${p.present} ✓ / ${p.late} ⏰ / ${p.absent} ✗`}
          >
            <div className="flex h-[120px] items-end gap-0.5">
              <div
                className="w-2 rounded-t bg-emerald-400"
                style={{ height: `${h(p.present)}px` }}
              />
              <div
                className="w-2 rounded-t bg-amber-400"
                style={{ height: `${h(p.late)}px` }}
              />
              <div
                className="w-2 rounded-t bg-rose-400"
                style={{ height: `${h(p.absent)}px` }}
              />
            </div>
            <div className="text-[9px] tabular-nums text-slate-500">
              {p.day.slice(-5)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const ACTIVITY_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  attendance: ClipboardCheck,
  leave: CalendarDays,
  salary: Coins,
  kpi: Trophy,
  device: Cpu,
};

function ActivityRow({
  item,
}: {
  item: {
    at: string;
    kind: string;
    title: string;
    body: string | null;
    employee_name: string | null;
  };
}) {
  const { t } = useTranslation();
  const Icon = ACTIVITY_ICON[item.kind] ?? Sparkles;
  const tone =
    item.kind === "attendance"
      ? "bg-sky-50 text-sky-700"
      : item.kind === "leave"
        ? "bg-indigo-50 text-indigo-700"
        : item.kind === "salary"
          ? "bg-emerald-50 text-emerald-700"
          : item.kind === "kpi"
            ? "bg-brand-50 text-brand-700"
            : "bg-slate-50 text-slate-700";
  return (
    <li className="flex gap-2.5 text-xs">
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full",
          tone
        )}
      >
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-semibold text-slate-800">
            {item.employee_name || "—"}
          </span>
          <span className="shrink-0 text-[10px] text-slate-400">
            {timeAgo(item.at)}
          </span>
        </div>
        <div className="truncate text-[11px] text-slate-600">
          {translateActivity(t, item.title)}
          {item.body ? ` · ${translateActivity(t, item.body)}` : ""}
        </div>
      </div>
    </li>
  );
}

/** The dashboard activity feed posts raw token strings like
 * ``"CHECK_IN"`` and ``"CHECK_IN · LATE"``. Translate every dot/space-
 * separated token through the ``activity.*`` namespace; anything we
 * don't have a label for falls through unchanged so we never break new
 * tokens.
 */
function translateActivity(
  t: (k: string) => string,
  value: string | null | undefined
): string {
  if (!value) return "";
  return value
    .split(/(\s·\s|\s)/)
    .map((tok) => {
      if (!tok || /^\s/.test(tok) || tok.includes("·")) return tok;
      const translated = t(`activity.${tok}`);
      return translated === `activity.${tok}` ? tok : translated;
    })
    .join("");
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-500">{label}</dt>
      <dd className="truncate font-medium text-ink-900">{value}</dd>
    </div>
  );
}

function timeAgo(iso: string): string {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

function monthName(year: number, month: number, locale: string): string {
  return new Date(year, month - 1, 1).toLocaleString(locale, {
    month: "long",
    year: "numeric",
  });
}
