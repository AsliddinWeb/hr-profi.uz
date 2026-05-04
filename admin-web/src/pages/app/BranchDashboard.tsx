import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  CalendarDays,
  ClipboardCheck,
  Clock,
  LogIn,
  Sparkles,
  Trophy,
  UserCheck,
  UserX,
  Users,
} from "lucide-react";

import { api } from "@/lib/api";
import { Card, CardSubtitle, CardTitle } from "@/components/ui/Card";
import { PageHeader } from "@/components/PageHeader";
import { SystemClock } from "@/components/SystemClock";
import { useAuthStore } from "@/stores/auth";
import { cn } from "@/lib/cn";
import type {
  Branch,
  DailyOverviewRow,
  KPIAssignmentDetail,
  LeaveRequest,
  Page as PaginatedPage,
} from "@/lib/types";

/**
 * Branch-manager dashboard. Reuses already-scoped endpoints — the backend
 * applies ``apply_branch_scope``/``Employee.branch_id == user.branch_id``
 * for BMs, so we don't need a dedicated ``/dashboard/branch-summary``
 * endpoint to keep the data right.
 *
 * Composition:
 *   - Today's live overview → present/late/absent/working stats.
 *   - Pending KPI count → "ready to approve" callout.
 *   - Pending leave count → "awaiting decision" callout.
 *   - Employees-in-branch count → shown as the headline.
 *   - Branch name (resolved from /branches list).
 */
export function BranchDashboard() {
  const { t } = useTranslation();
  const branchId = useAuthStore((s) => s.user?.branch_id) ?? null;

  const todayQ = useQuery({
    queryKey: ["bm-dashboard", "today-overview"],
    queryFn: async () =>
      (await api.get<DailyOverviewRow[]>("/attendance/daily-overview")).data,
    refetchInterval: 60_000,
  });

  const pendingLeavesQ = useQuery({
    queryKey: ["bm-dashboard", "pending-leaves"],
    queryFn: async () =>
      (
        await api.get<LeaveRequest[]>("/leave-requests", {
          params: { status: "PENDING" },
        })
      ).data,
    refetchInterval: 5 * 60_000,
  });

  const kpiPendingQ = useQuery({
    queryKey: ["bm-dashboard", "kpi-pending"],
    queryFn: async () => {
      const now = new Date();
      return (
        await api.get<PaginatedPage<KPIAssignmentDetail>>("/kpi/assignments", {
          params: {
            year: now.getFullYear(),
            month: now.getMonth() + 1,
            status: "COMPUTED",
            size: 100,
          },
        })
      ).data;
    },
    refetchInterval: 5 * 60_000,
  });

  const branchesQ = useQuery({
    queryKey: ["bm-dashboard", "branches"],
    queryFn: async () => (await api.get<Branch[]>("/branches")).data,
    staleTime: 5 * 60_000,
  });

  const branchName = useMemo(
    () => branchesQ.data?.find((b) => b.id === branchId)?.name ?? "—",
    [branchesQ.data, branchId]
  );

  const stats = useMemo(() => {
    const rows = todayQ.data ?? [];
    let working = 0;
    let present = 0;
    let late = 0;
    let absent = 0;
    let on_leave = 0;
    for (const r of rows) {
      if (r.is_currently_in) working += 1;
      if (r.shift_status === "PRESENT" || r.shift_status === "IN_PROGRESS")
        present += 1;
      if (r.shift_status === "LATE") late += 1;
      if (r.shift_status === "ABSENT") absent += 1;
      if (r.shift_status === "ON_LEAVE") on_leave += 1;
    }
    return {
      total: rows.length,
      working,
      present,
      late,
      absent,
      on_leave,
    };
  }, [todayQ.data]);

  const pendingLeaves = pendingLeavesQ.data?.length ?? 0;
  const pendingKpis = kpiPendingQ.data?.total ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("branch_dashboard.title")}
        breadcrumbs={[{ label: t("nav.dashboard") }]}
        icon={<UserCheck className="size-5" />}
        description={
          <span className="inline-flex items-center gap-1.5">
            <span>{t("branch_dashboard.your_branch")}:</span>
            <span className="font-semibold text-slate-800">{branchName}</span>
          </span>
        }
        actions={<SystemClock />}
      />

      {/* Headline tiles */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile
          tone="brand"
          icon={<Users className="size-4" />}
          label={t("branch_dashboard.stat_total")}
          value={stats.total}
        />
        <Tile
          tone="emerald"
          icon={<UserCheck className="size-4" />}
          label={t("branch_dashboard.stat_working")}
          value={stats.working}
        />
        <Tile
          tone="amber"
          icon={<Clock className="size-4" />}
          label={t("branch_dashboard.stat_late")}
          value={stats.late}
        />
        <Tile
          tone="rose"
          icon={<UserX className="size-4" />}
          label={t("branch_dashboard.stat_absent")}
          value={stats.absent}
        />
        <Tile
          tone="indigo"
          icon={<CalendarDays className="size-4" />}
          label={t("branch_dashboard.stat_on_leave")}
          value={stats.on_leave}
        />
      </div>

      {/* Pending callouts */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <ActionCard
          to="/app/leaves"
          icon={<CalendarDays className="size-5" />}
          tone="indigo"
          title={t("branch_dashboard.pending_leaves_title")}
          count={pendingLeaves}
          hint={t("branch_dashboard.pending_leaves_hint")}
        />
        <ActionCard
          to="/app/kpi"
          icon={<Trophy className="size-5" />}
          tone="brand"
          title={t("branch_dashboard.pending_kpis_title")}
          count={pendingKpis}
          hint={t("branch_dashboard.pending_kpis_hint")}
        />
      </div>

      {/* Quick links */}
      <Card>
        <CardTitle>{t("branch_dashboard.quick_links")}</CardTitle>
        <CardSubtitle>{t("branch_dashboard.quick_links_hint")}</CardSubtitle>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <QuickLink
            to="/app/attendance"
            icon={<ClipboardCheck className="size-4" />}
            label={t("nav.attendance")}
          />
          <QuickLink
            to="/app/employees"
            icon={<Users className="size-4" />}
            label={t("nav.employees")}
          />
          <QuickLink
            to="/app/shifts"
            icon={<LogIn className="size-4" />}
            label={t("nav.shifts")}
          />
          <QuickLink
            to="/app/leaves"
            icon={<CalendarDays className="size-4" />}
            label={t("nav.leaves")}
          />
        </div>
      </Card>
    </div>
  );
}

function Tile({
  tone,
  icon,
  label,
  value,
}: {
  tone: "brand" | "emerald" | "amber" | "rose" | "indigo";
  icon: React.ReactNode;
  label: string;
  value: number | string;
}) {
  const cls = {
    brand: "bg-brand-50 text-brand-800 ring-brand-200",
    emerald: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    amber: "bg-amber-50 text-amber-800 ring-amber-200",
    rose: "bg-rose-50 text-rose-800 ring-rose-200",
    indigo: "bg-indigo-50 text-indigo-800 ring-indigo-200",
  }[tone];
  return (
    <div className={cn("rounded-xl px-4 py-3 ring-1", cls)}>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide opacity-70">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

function ActionCard({
  to,
  icon,
  tone,
  title,
  count,
  hint,
}: {
  to: string;
  icon: React.ReactNode;
  tone: "indigo" | "brand";
  title: string;
  count: number;
  hint: string;
}) {
  const cls = {
    indigo:
      "bg-indigo-50 text-indigo-900 ring-indigo-200 hover:bg-indigo-100",
    brand: "bg-brand-50 text-brand-900 ring-brand-200 hover:bg-brand-100",
  }[tone];
  const empty = count === 0;
  return (
    <Link
      to={to}
      className={cn(
        "flex items-center gap-3 rounded-xl px-4 py-3 ring-1 transition active:scale-[0.99]",
        empty ? "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50" : cls
      )}
    >
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-xl",
          empty
            ? "bg-slate-100 text-slate-400"
            : tone === "indigo"
              ? "bg-indigo-100 text-indigo-700"
              : "bg-brand-100 text-brand-700"
        )}
      >
        {empty ? <Sparkles className="size-5" /> : icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold">{title}</span>
          <span className="ml-auto text-xl font-bold tabular-nums">{count}</span>
        </div>
        <p className="mt-0.5 text-[11px] opacity-80">{hint}</p>
      </div>
    </Link>
  );
}

function QuickLink({
  to,
  icon,
  label,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-brand-300 hover:bg-brand-50"
    >
      {icon}
      {label}
    </Link>
  );
}
