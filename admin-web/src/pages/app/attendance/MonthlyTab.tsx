import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ChevronLeft,
  ChevronRight,
  ChevronRight as ChevR,
  Coins,
  Search,
} from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/Table";
import { cn } from "@/lib/cn";
import type {
  Branch,
  MonthlyOverviewRow,
  Page,
  PeriodWithEmployee,
} from "@/lib/types";

import { fmtDurationShort, fmtHM, initialsOf } from "./utils";

function fmtMoney(n: number | string | null | undefined): string {
  if (n == null || n === "") return "—";
  const v = typeof n === "string" ? Number(n) : n;
  if (!Number.isFinite(v) || v === 0) return "—";
  return Math.round(v).toLocaleString("ru-RU").replace(/,/g, " ");
}

export function MonthlyTab() {
  const { t, i18n } = useTranslation();
  const nav = useNavigate();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [query, setQuery] = useState("");
  const [branchFilter, setBranchFilter] = useState<string>("all");

  const branchesQ = useQuery({
    queryKey: ["branches", "for-attendance-monthly"],
    queryFn: async () =>
      (await api.get<Page<Branch>>("/branches", { params: { size: 200 } })).data,
  });

  const monthlyQ = useQuery({
    queryKey: ["attendance", "monthly-overview", year, month, branchFilter],
    queryFn: async () => {
      const params: Record<string, string | number> = { year, month };
      if (branchFilter !== "all") params.branch_id = branchFilter;
      return (
        await api.get<MonthlyOverviewRow[]>("/attendance/monthly-overview", { params })
      ).data;
    },
    staleTime: 0,
  });

  // Parallel salary periods fetch — feeds the money columns and the click-to-
  // breakdown action. Cheap, single endpoint, same month.
  const periodsQ = useQuery({
    queryKey: ["salary", "periods", year, month, branchFilter],
    queryFn: async () => {
      const params: Record<string, string | number> = { year, month };
      if (branchFilter !== "all") params.branch_id = branchFilter;
      return (
        await api.get<PeriodWithEmployee[]>("/salary/periods", { params })
      ).data;
    },
    staleTime: 30_000,
  });

  const branches = branchesQ.data?.items ?? [];
  const rows = monthlyQ.data ?? [];
  const periodByEmp = useMemo(() => {
    const map = new Map<string, PeriodWithEmployee>();
    for (const p of periodsQ.data ?? []) map.set(p.employee_id, p);
    return map;
  }, [periodsQ.data]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.full_name.toLowerCase().includes(q) ||
        r.employee_code.toLowerCase().includes(q)
    );
  }, [rows, query]);

  const totals = useMemo(() => {
    const out = {
      employees: rows.length,
      days_worked: 0,
      total_minutes: 0,
      late_minutes: 0,
      overtime_minutes: 0,
      absences: 0,
      paid: 0,
      pending: 0,
      earned: 0,
    };
    for (const r of rows) {
      out.days_worked += r.days_worked;
      out.total_minutes += r.total_minutes;
      out.late_minutes += r.late_minutes;
      out.overtime_minutes += r.overtime_minutes;
      out.absences += r.absence_days;
      const p = periodByEmp.get(r.employee_id)?.period;
      if (p) {
        out.earned += Number(p.total_earned) || 0;
        out.paid += Number(p.paid_amount) || 0;
      }
      out.pending +=
        Number(periodByEmp.get(r.employee_id)?.pending_amount) || 0;
    }
    return out;
  }, [rows, periodByEmp]);

  const stepMonth = (delta: number) => {
    let y = year;
    let m = month + delta;
    if (m < 1) {
      y -= 1;
      m = 12;
    } else if (m > 12) {
      y += 1;
      m = 1;
    }
    setYear(y);
    setMonth(m);
  };

  const monthLabel = new Date(year, month - 1, 1).toLocaleString(i18n.language, {
    month: "long",
    year: "numeric",
  });

  const exportCsv = () => {
    if (filtered.length === 0) return;
    // BOM forces UTF-8 detection in Excel/Yandex Sheets so Cyrillic names
    // come through clean.
    const BOM = "﻿";
    const headers = [
      t("employees.code"),
      t("employees.full_name"),
      t("attendance.col_days"),
      t("attendance.col_hours"),
      t("attendance.col_late"),
      t("attendance.col_overtime"),
      t("attendance.col_rest"),
      t("attendance.col_absences"),
      t("salary_page.total"),
      t("salary_page.paid"),
      t("salary_page.pending"),
      t("salary_page.status"),
    ];
    const lines = filtered.map((r) => {
      const period = periodByEmp.get(r.employee_id);
      const p = period?.period;
      return [
        `"${r.employee_code}"`,
        `"${r.full_name.replace(/"/g, '""')}"`,
        r.days_worked,
        (r.total_minutes / 60).toFixed(2),
        r.late_minutes,
        r.overtime_minutes,
        r.rest_days_planned,
        r.absence_days,
        Math.round(Number(p?.total_earned) || 0),
        Math.round(Number(p?.paid_amount) || 0),
        Math.round(Number(period?.pending_amount) || 0),
        p?.status ?? "—",
      ].join(",");
    });
    const blob = new Blob([BOM + [headers.join(","), ...lines].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `attendance-${year}-${String(month).padStart(2, "0")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
          <Button type="button" variant="ghost" size="sm" iconOnly onClick={() => stepMonth(-1)}>
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-[160px] text-center text-sm font-semibold capitalize text-slate-700">
            {monthLabel}
          </span>
          <Button type="button" variant="ghost" size="sm" iconOnly onClick={() => stepMonth(1)}>
            <ChevronRight className="size-4" />
          </Button>
        </div>

        <div className="min-w-[200px] flex-1">
          <Input
            label={t("attendance.search_label")}
            placeholder={t("attendance.search_placeholder") ?? ""}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            prefix={<Search className="size-4" />}
          />
        </div>
        <div>
          <label className="label">{t("employees.branch")}</label>
          <select
            className="input min-w-[160px]"
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
          >
            <option value="all">{t("departments_page.branch_all")}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div className="ml-auto">
          <Button
            type="button"
            variant="secondary"
            onClick={exportCsv}
            disabled={filtered.length === 0}
          >
            {t("attendance.export_csv")}
          </Button>
        </div>
      </div>

      {/* Totals strip — first row covers attendance metrics, second row the
          salary side so HR can scan both impacts side-by-side. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label={t("attendance.stat_employees")} value={totals.employees} />
        <Tile label={t("attendance.stat_days_worked")} value={totals.days_worked} />
        <Tile label={t("attendance.stat_total_hours")} value={fmtHM(totals.total_minutes)} />
        <Tile
          tone="amber"
          label={t("attendance.stat_late_minutes")}
          value={totals.late_minutes}
        />
        <Tile
          tone="emerald"
          label={t("attendance.stat_overtime_minutes")}
          value={totals.overtime_minutes}
        />
        <Tile tone="rose" label={t("attendance.stat_absence_days")} value={totals.absences} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Tile
          tone="brand"
          label={t("attendance.stat_payroll_total")}
          value={fmtMoney(totals.earned)}
        />
        <Tile
          tone="emerald"
          label={t("attendance.stat_payroll_paid")}
          value={fmtMoney(totals.paid)}
        />
        <Tile
          tone={totals.pending > 0 ? "amber" : "slate"}
          label={t("attendance.stat_payroll_pending")}
          value={fmtMoney(totals.pending)}
        />
      </div>

      {/* Table */}
      <Table className="min-w-[1280px]">
        <THead>
          <TR>
            <TH className="w-12" />
            <TH>{t("employees.full_name")}</TH>
            <TH className="text-right">{t("attendance.col_days")}</TH>
            <TH className="text-right">{t("attendance.col_hours")}</TH>
            <TH className="text-right">{t("attendance.col_late")}</TH>
            <TH className="text-right">{t("attendance.col_overtime")}</TH>
            <TH className="text-right">{t("attendance.col_rest")}</TH>
            <TH className="text-right">{t("attendance.col_absences")}</TH>
            <TH className="text-right">{t("salary_page.total")}</TH>
            <TH className="text-right">{t("salary_page.paid")}</TH>
            <TH className="text-right">{t("salary_page.pending")}</TH>
            <TH className="w-10" />
          </TR>
        </THead>
        <TBody>
          {monthlyQ.isLoading ? (
            <TR>
              <TD colSpan={12} className="text-center text-sm text-slate-500">
                {t("common.loading")}
              </TD>
            </TR>
          ) : monthlyQ.isError ? (
            <TR>
              <TD colSpan={12} className="text-center text-sm text-red-600">
                {apiErrorMessage(monthlyQ.error)}
              </TD>
            </TR>
          ) : filtered.length === 0 ? (
            <TR>
              <TD colSpan={12} className="text-center text-sm text-slate-500">
                {t("common.no_data")}
              </TD>
            </TR>
          ) : (
            filtered.map((r) => {
              const period = periodByEmp.get(r.employee_id);
              const p = period?.period;
              return (
                <TR
                  key={r.employee_id}
                  className="cursor-pointer hover:bg-slate-50/70"
                  onClick={() =>
                    nav(
                      `/app/salary/employee/${r.employee_id}?year=${year}&month=${month}`
                    )
                  }
                >
                  <TD>
                    {r.photo_url ? (
                      <img
                        src={r.photo_url}
                        alt=""
                        className="size-8 rounded-full object-cover ring-1 ring-slate-200"
                      />
                    ) : (
                      <span className="flex size-8 items-center justify-center rounded-full bg-brand-50 text-[10px] font-semibold text-brand-700">
                        {initialsOf(r.full_name) || "•"}
                      </span>
                    )}
                  </TD>
                  <TD className="font-medium">
                    <div className="text-sm">{r.full_name}</div>
                    <div className="text-[11px] text-slate-400">{r.employee_code}</div>
                  </TD>
                  <TD className="text-right tabular-nums">{r.days_worked}</TD>
                  <TD className="text-right tabular-nums">{fmtHM(r.total_minutes)}</TD>
                  <TD
                    className={cn(
                      "text-right tabular-nums",
                      r.late_minutes > 0 && "font-semibold text-amber-700"
                    )}
                  >
                    {r.late_minutes > 0 ? fmtDurationShort(r.late_minutes) : "—"}
                  </TD>
                  <TD
                    className={cn(
                      "text-right tabular-nums",
                      r.overtime_minutes > 0 && "font-semibold text-emerald-700"
                    )}
                  >
                    {r.overtime_minutes > 0 ? fmtDurationShort(r.overtime_minutes) : "—"}
                  </TD>
                  <TD className="text-right tabular-nums text-slate-600">
                    {r.rest_days_planned}
                  </TD>
                  <TD
                    className={cn(
                      "text-right tabular-nums",
                      r.absence_days > 0 && "font-semibold text-rose-700"
                    )}
                  >
                    {r.absence_days > 0 ? r.absence_days : "—"}
                  </TD>
                  <TD className="text-right tabular-nums">
                    <span className="inline-flex items-center gap-1 font-semibold text-slate-800">
                      <Coins className="size-3 text-brand-500" />
                      {fmtMoney(p?.total_earned ?? null)}
                    </span>
                  </TD>
                  <TD className="text-right tabular-nums text-emerald-700">
                    {fmtMoney(p?.paid_amount ?? null)}
                  </TD>
                  <TD className="text-right tabular-nums">
                    {Number(period?.pending_amount) > 0 ? (
                      <span className="font-semibold text-amber-700">
                        {fmtMoney(period?.pending_amount)}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </TD>
                  <TD className="text-right text-slate-400">
                    <ChevR className="ml-auto size-4" />
                  </TD>
                </TR>
              );
            })
          )}
        </TBody>
      </Table>
    </div>
  );
}

function Tile({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: number | string;
  tone?: "slate" | "amber" | "emerald" | "rose" | "brand";
}) {
  const cls = {
    slate: "border-slate-200 bg-white text-slate-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
    rose: "border-rose-200 bg-rose-50 text-rose-800",
    brand: "border-brand-200 bg-brand-50 text-brand-800",
  }[tone];
  return (
    <div className={cn("rounded-lg border px-3 py-2", cls)}>
      <div className="text-[10px] uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-0.5 text-base font-bold tabular-nums">{value}</div>
    </div>
  );
}
