import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Activity,
  Building2,
  Coins,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";

import { api } from "@/lib/api";
import { Input } from "@/components/ui/Input";
import { useEnumLabel } from "@/lib/enum";
import { cn } from "@/lib/cn";
import type {
  KPIBranchBreakdown,
  KPIDashboardSummary,
  KPIScoreTrendPoint,
} from "@/lib/types";

import {
  CATEGORY_COLOR,
  STATUS_TONE,
  fmtMoney,
  fmtScore,
  monthLabel,
  scoreTone,
} from "./utils";

export function DashboardTab() {
  const { t, i18n } = useTranslation();
  const label = useEnumLabel();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [trendMonths, setTrendMonths] = useState(12);

  const summaryQ = useQuery({
    queryKey: ["kpi", "dashboard", "summary", year, month],
    queryFn: async () =>
      (
        await api.get<KPIDashboardSummary>("/kpi/dashboard/summary", {
          params: { year, month },
        })
      ).data,
  });
  const branchesQ = useQuery({
    queryKey: ["kpi", "dashboard", "branches", year, month],
    queryFn: async () =>
      (
        await api.get<KPIBranchBreakdown[]>("/kpi/dashboard/branches", {
          params: { year, month },
        })
      ).data,
  });
  const trendQ = useQuery({
    queryKey: ["kpi", "dashboard", "trend", trendMonths],
    queryFn: async () =>
      (
        await api.get<KPIScoreTrendPoint[]>("/kpi/dashboard/trend", {
          params: { months: trendMonths },
        })
      ).data,
  });

  const s = summaryQ.data;
  const sTone = scoreTone(s?.avg_score ?? 0);
  const maxBranchAvg = Math.max(
    1,
    ...((branchesQ.data ?? []).map((b) => Number(b.avg_score)))
  );
  const trend = trendQ.data ?? [];
  const maxTrend = Math.max(1, ...trend.map((p) => Number(p.avg_score)));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <Input
          type="number"
          label={t("kpi_page.year")}
          value={year}
          onChange={(e) => setYear(Number(e.target.value) || today.getFullYear())}
          className="w-24"
        />
        <Input
          type="number"
          min={1}
          max={12}
          label={t("kpi_page.month")}
          value={month}
          onChange={(e) => setMonth(Number(e.target.value) || today.getMonth() + 1)}
          className="w-24"
        />
        <p className="ml-2 mb-2 text-sm text-slate-500">
          {monthLabel(year, month, i18n.language)}
        </p>
      </div>

      {/* Top stats */}
      {s && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Tile
            tone="brand"
            icon={<Users className="size-4" />}
            label={t("kpi_page.stat_employees")}
            value={s.employees_with_kpis.toLocaleString()}
          />
          <Tile
            tone="indigo"
            icon={<Activity className="size-4" />}
            label={t("kpi_page.stat_assignments")}
            value={s.total_assignments.toLocaleString()}
          />
          <div
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-2 ring-1",
              sTone.bg,
              sTone.text,
              sTone.ring
            )}
          >
            <TrendingUp className="size-4" />
            <div>
              <div className="text-[10px] uppercase tracking-wide opacity-70">
                {t("kpi_page.stat_avg_score")}
              </div>
              <div className="text-base font-bold tabular-nums leading-tight">
                {fmtScore(s.avg_score)}%
              </div>
            </div>
          </div>
          <Tile
            tone="emerald"
            icon={<Coins className="size-4" />}
            label={t("kpi_page.stat_total_reward")}
            value={fmtMoney(s.total_reward)}
          />
          <Tile
            tone="rose"
            icon={<TrendingDown className="size-4" />}
            label={t("kpi_page.stat_total_penalty")}
            value={fmtMoney(s.total_penalty)}
          />
        </div>
      )}

      {/* By status + by category */}
      {s && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Card title={t("kpi_page.by_status")}>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(s.by_status).length === 0 ? (
                <p className="text-xs text-slate-400">—</p>
              ) : (
                Object.entries(s.by_status).map(([status, count]) => {
                  const tone = STATUS_TONE[status as keyof typeof STATUS_TONE];
                  return (
                    <span
                      key={status}
                      className={cn(
                        "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ring-1",
                        tone?.badge === "success"
                          ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                          : tone?.badge === "warning"
                          ? "bg-amber-50 text-amber-700 ring-amber-200"
                          : tone?.badge === "danger"
                          ? "bg-rose-50 text-rose-700 ring-rose-200"
                          : tone?.badge === "info"
                          ? "bg-sky-50 text-sky-700 ring-sky-200"
                          : "bg-slate-100 text-slate-700 ring-slate-200"
                      )}
                    >
                      <span>
                        {label(
                          "kpi_assignment_status",
                          status as never
                        )}
                      </span>
                      <span className="rounded-full bg-white/60 px-1.5 text-[10px] font-bold tabular-nums">
                        {count}
                      </span>
                    </span>
                  );
                })
              )}
            </div>
          </Card>
          <Card title={t("kpi_page.by_category")}>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(s.by_category).length === 0 ? (
                <p className="text-xs text-slate-400">—</p>
              ) : (
                Object.entries(s.by_category).map(([cat, count]) => (
                  <span
                    key={cat}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ring-1",
                      CATEGORY_COLOR[cat as keyof typeof CATEGORY_COLOR] ??
                        "bg-slate-100 text-slate-700 ring-slate-200"
                    )}
                  >
                    <span>{label("kpi_category", cat as never)}</span>
                    <span className="rounded-full bg-white/70 px-1.5 text-[10px] font-bold tabular-nums">
                      {count}
                    </span>
                  </span>
                ))
              )}
            </div>
          </Card>
        </div>
      )}

      {/* Branches breakdown */}
      <Card
        title={t("kpi_page.branches_breakdown")}
        icon={<Building2 className="size-4" />}
      >
        {branchesQ.isLoading ? (
          <p className="text-xs text-slate-500">…</p>
        ) : (branchesQ.data ?? []).length === 0 ? (
          <p className="text-xs text-slate-400">{t("kpi_page.no_data_for_period")}</p>
        ) : (
          <ul className="space-y-2">
            {(branchesQ.data ?? []).map((b) => (
              <li key={b.branch_id ?? "_none"} className="space-y-1">
                <div className="flex items-baseline justify-between text-xs">
                  <span className="font-semibold text-slate-700">
                    {b.branch_name ?? "—"}
                    <span className="ml-1.5 text-[10px] text-slate-400">
                      ({b.employees})
                    </span>
                  </span>
                  <span className="flex items-baseline gap-3 tabular-nums">
                    <span className="text-emerald-700">
                      +{fmtMoney(b.total_reward)}
                    </span>
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-0.5 ring-1",
                        scoreTone(b.avg_score).bg,
                        scoreTone(b.avg_score).text,
                        scoreTone(b.avg_score).ring
                      )}
                    >
                      {fmtScore(b.avg_score)}%
                    </span>
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      Number(b.avg_score) >= 100
                        ? "bg-emerald-500"
                        : Number(b.avg_score) >= 80
                        ? "bg-brand-500"
                        : Number(b.avg_score) >= 50
                        ? "bg-amber-500"
                        : "bg-rose-500"
                    )}
                    style={{
                      width: `${Math.min(100, (Number(b.avg_score) / maxBranchAvg) * 100)}%`,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Trend */}
      <Card
        title={t("kpi_page.trend_title", { months: trendMonths })}
        icon={<TrendingUp className="size-4" />}
        action={
          <select
            className="input !py-1 text-xs"
            value={trendMonths}
            onChange={(e) => setTrendMonths(Number(e.target.value))}
          >
            <option value={6}>6</option>
            <option value={12}>12</option>
            <option value={24}>24</option>
          </select>
        }
      >
        {trend.length === 0 ? (
          <p className="text-xs text-slate-400">{t("kpi_page.no_data_for_period")}</p>
        ) : (
          <div className="flex items-end gap-1 overflow-x-auto pb-1">
            {trend.map((p) => {
              const h = Math.max(4, (Number(p.avg_score) / maxTrend) * 120);
              return (
                <div
                  key={`${p.year}-${p.month}`}
                  className="flex min-w-[44px] flex-col items-center gap-1"
                  title={`${p.year}-${String(p.month).padStart(2, "0")} · ${fmtScore(p.avg_score)}% · ${fmtMoney(p.total_reward)}`}
                >
                  <div className="text-[9px] tabular-nums text-slate-500">
                    {fmtScore(p.avg_score)}
                  </div>
                  <div
                    className={cn(
                      "w-6 rounded-t",
                      Number(p.avg_score) >= 100
                        ? "bg-emerald-400"
                        : Number(p.avg_score) >= 80
                        ? "bg-brand-400"
                        : Number(p.avg_score) >= 50
                        ? "bg-amber-400"
                        : "bg-rose-400"
                    )}
                    style={{ height: `${h}px` }}
                  />
                  <div className="text-[9px] text-slate-500">
                    {String(p.month).padStart(2, "0")}/{String(p.year).slice(-2)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
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
  value: string;
}) {
  const cls = {
    brand: "border-brand-200 bg-brand-50 text-brand-800",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    rose: "border-rose-200 bg-rose-50 text-rose-800",
    indigo: "border-indigo-200 bg-indigo-50 text-indigo-800",
  }[tone];
  return (
    <div className={cn("flex items-center gap-2 rounded-lg border px-3 py-2", cls)}>
      <span className="opacity-70">{icon}</span>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wide opacity-70">
          {label}
        </div>
        <div className="text-base font-bold tabular-nums leading-tight">
          {value}
        </div>
      </div>
    </div>
  );
}

function Card({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600">
          {icon}
          {title}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}
