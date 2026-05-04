import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Coins,
  LayoutGrid,
  LayoutList,
  Plus,
  Search,
} from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import type { LeaveBalanceRow, LeaveType } from "@/lib/types";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

type ViewMode = "grouped" | "flat";
type SortKey = "name" | "used_desc" | "used_asc" | "remaining_asc" | "over_cap";

export function BalancesTab() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [query, setQuery] = useState("");
  const [paidFilter, setPaidFilter] = useState<"all" | "paid" | "unpaid">("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [view, setView] = useState<ViewMode>("grouped");
  const [sortKey, setSortKey] = useState<SortKey>("name");

  const balancesQ = useQuery({
    queryKey: ["leave-balances", year],
    queryFn: async () =>
      (
        await api.get<LeaveBalanceRow[]>("/leave-requests/balances", {
          params: { year },
        })
      ).data,
    staleTime: 30_000,
  });
  const typesQ = useQuery({
    queryKey: ["leave-types"],
    queryFn: async () => (await api.get<LeaveType[]>("/leave-types")).data,
  });

  const rows = balancesQ.data ?? [];
  const types = typesQ.data ?? [];

  /** Apply search / paid / type filters to the raw rows. Used by both the
   * grouped and flat views. */
  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (paidFilter === "paid" && !r.paid) return false;
      if (paidFilter === "unpaid" && r.paid) return false;
      if (typeFilter !== "all" && r.leave_type_id !== typeFilter) return false;
      if (
        q &&
        !r.full_name.toLowerCase().includes(q) &&
        !r.employee_code.toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [rows, query, paidFilter, typeFilter]);

  /** Same `(employee, type)` rows but sorted in place for the flat view. */
  const sortedFlat = useMemo(() => {
    const list = [...filteredRows];
    list.sort((a, b) => {
      switch (sortKey) {
        case "used_desc":
          return b.used_days - a.used_days || a.full_name.localeCompare(b.full_name);
        case "used_asc":
          return a.used_days - b.used_days || a.full_name.localeCompare(b.full_name);
        case "remaining_asc": {
          const ra = a.remaining ?? Number.POSITIVE_INFINITY;
          const rb = b.remaining ?? Number.POSITIVE_INFINITY;
          return ra - rb || a.full_name.localeCompare(b.full_name);
        }
        case "over_cap": {
          const aOver =
            a.max_days_per_year != null && a.used_days > a.max_days_per_year ? 1 : 0;
          const bOver =
            b.max_days_per_year != null && b.used_days > b.max_days_per_year ? 1 : 0;
          if (aOver !== bOver) return bOver - aOver;
          return a.full_name.localeCompare(b.full_name);
        }
        default:
          return a.full_name.localeCompare(b.full_name);
      }
    });
    return list;
  }, [filteredRows, sortKey]);

  // Group rows by employee — one card per employee with all their leave types.
  const byEmployee = useMemo(() => {
    const map = new Map<
      string,
      { full_name: string; employee_code: string; photo_url: string | null; rows: LeaveBalanceRow[] }
    >();
    for (const r of filteredRows) {
      const existing = map.get(r.employee_id);
      if (existing) {
        existing.rows.push(r);
      } else {
        map.set(r.employee_id, {
          full_name: r.full_name,
          employee_code: r.employee_code,
          photo_url: r.photo_url,
          rows: [r],
        });
      }
    }
    // Sort by sortKey (employee-level): for usage-based sorts we use the row
    // with the highest usage in the group; otherwise alphabetic.
    const list = Array.from(map.entries()).sort(([, a], [, b]) => {
      if (sortKey === "used_desc" || sortKey === "used_asc") {
        const aMax = Math.max(...a.rows.map((r) => r.used_days), 0);
        const bMax = Math.max(...b.rows.map((r) => r.used_days), 0);
        return sortKey === "used_desc" ? bMax - aMax : aMax - bMax;
      }
      if (sortKey === "over_cap") {
        const aOver = a.rows.some(
          (r) => r.max_days_per_year != null && r.used_days > r.max_days_per_year
        );
        const bOver = b.rows.some(
          (r) => r.max_days_per_year != null && r.used_days > r.max_days_per_year
        );
        if (aOver !== bOver) return aOver ? -1 : 1;
      }
      return a.full_name.localeCompare(b.full_name);
    });
    list.forEach(([, group]) =>
      group.rows.sort((a, b) => a.leave_type_name.localeCompare(b.leave_type_name))
    );
    return list;
  }, [filteredRows, sortKey]);

  const totals = useMemo(() => {
    const usedPaid = rows.filter((r) => r.paid).reduce((s, r) => s + r.used_days, 0);
    const usedUnpaid = rows.filter((r) => !r.paid).reduce((s, r) => s + r.used_days, 0);
    const overCap = rows.filter(
      (r) => r.max_days_per_year != null && r.used_days > r.max_days_per_year
    ).length;
    const paidAmount = rows.reduce(
      (s, r) => s + (Number(r.total_paid_amount) || 0),
      0
    );
    return { usedPaid, usedUnpaid, overCap, paidAmount };
  }, [rows]);

  const fmtMoney = (n: number) =>
    Number.isFinite(n) && n > 0
      ? Math.round(n).toLocaleString("ru-RU").replace(/,/g, " ")
      : "—";

  const exportCsv = () => {
    if (rows.length === 0) return;
    // Excel/Yandex Sheets read CP1251 by default for csv; the BOM marker
    // forces UTF-8 detection so the Cyrillic / Latin-extended employee names
    // come through clean.
    const BOM = "﻿";
    // Use the visible (filtered+sorted) flat list so the export matches the
    // current view, not the raw payload.
    const lines = sortedFlat.map((r) =>
      [
        `"${r.employee_code}"`,
        `"${r.full_name.replace(/"/g, '""')}"`,
        `"${r.leave_type_name.replace(/"/g, '""')}"`,
        r.paid ? "paid" : "unpaid",
        r.max_days_per_year ?? "",
        r.used_days,
        r.remaining ?? "",
        Math.round(Number(r.total_paid_amount) || 0),
      ].join(",")
    );
    const headers = [
      t("employees.code"),
      t("employees.full_name"),
      t("leaves.type"),
      t("leaves.salary_impact"),
      t("leaves.col_max"),
      t("leaves.col_used"),
      t("leaves.col_remaining"),
      `${t("leaves.payout_total")} (${t("employees.currency_short")})`,
    ];
    const csv = BOM + [headers.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leave-balances-${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
          <Button type="button" variant="ghost" size="sm" iconOnly onClick={() => setYear(year - 1)}>
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-[80px] text-center text-sm font-semibold tabular-nums text-slate-700">
            {year}
          </span>
          <Button type="button" variant="ghost" size="sm" iconOnly onClick={() => setYear(year + 1)}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <div className="min-w-[200px] flex-1">
          <Input
            label={t("leaves.search")}
            placeholder={t("leaves.search_placeholder") ?? ""}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            prefix={<Search className="size-4" />}
          />
        </div>
        <div>
          <label className="label">{t("leaves.salary_impact")}</label>
          <select
            className="input min-w-[140px]"
            value={paidFilter}
            onChange={(e) => setPaidFilter(e.target.value as typeof paidFilter)}
          >
            <option value="all">{t("branches.status_all")}</option>
            <option value="paid">{t("leaves.paid")}</option>
            <option value="unpaid">{t("leaves.unpaid")}</option>
          </select>
        </div>
        <div>
          <label className="label">{t("leaves.type")}</label>
          <select
            className="input min-w-[160px]"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="all">{t("branches.status_all")}</option>
            {types.map((tp) => (
              <option key={tp.id} value={tp.id}>
                {tp.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{t("leaves.sort_by")}</label>
          <select
            className="input min-w-[160px]"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
          >
            <option value="name">{t("leaves.sort_name")}</option>
            <option value="used_desc">{t("leaves.sort_used_desc")}</option>
            <option value="used_asc">{t("leaves.sort_used_asc")}</option>
            <option value="remaining_asc">{t("leaves.sort_remaining_asc")}</option>
            <option value="over_cap">{t("leaves.sort_over_cap")}</option>
          </select>
        </div>
        <div className="ml-auto flex items-end gap-2">
          {/* View toggle: grouped (cards) vs flat (single table) */}
          <div className="flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-0.5">
            <button
              type="button"
              onClick={() => setView("grouped")}
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium",
                view === "grouped"
                  ? "bg-brand-50 text-brand-700"
                  : "text-slate-500 hover:bg-slate-50"
              )}
              title={t("leaves.view_grouped") ?? undefined}
            >
              <LayoutGrid className="size-3.5" />
              {t("leaves.view_grouped")}
            </button>
            <button
              type="button"
              onClick={() => setView("flat")}
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium",
                view === "flat"
                  ? "bg-brand-50 text-brand-700"
                  : "text-slate-500 hover:bg-slate-50"
              )}
              title={t("leaves.view_flat") ?? undefined}
            >
              <LayoutList className="size-3.5" />
              {t("leaves.view_flat")}
            </button>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={exportCsv}
            disabled={rows.length === 0}
          >
            {t("attendance.export_csv")}
          </Button>
          <Button type="button" onClick={() => nav("/app/leaves/balances/new")}>
            <Plus className="size-4" />
            {t("leaves.adjust_create_short")}
          </Button>
        </div>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          tone="emerald"
          label={t("leaves.totals_paid_used")}
          value={`${totals.usedPaid} ${t("leaves.days_count")}`}
        />
        <Tile
          tone="slate"
          label={t("leaves.totals_unpaid_used")}
          value={`${totals.usedUnpaid} ${t("leaves.days_count")}`}
        />
        <Tile
          tone="brand"
          label={t("leaves.totals_paid_amount")}
          value={`${fmtMoney(totals.paidAmount)} ${t("employees.currency_short")}`}
        />
        <Tile
          tone={totals.overCap > 0 ? "rose" : "emerald"}
          label={t("leaves.totals_over_cap")}
          value={String(totals.overCap)}
        />
      </div>

      {balancesQ.isLoading ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          {t("common.loading")}
        </div>
      ) : balancesQ.isError ? (
        <p className="text-sm text-red-600">{apiErrorMessage(balancesQ.error)}</p>
      ) : (view === "flat" ? sortedFlat.length : byEmployee.length) === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          {t("common.no_data")}
        </div>
      ) : view === "flat" ? (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <Table className="min-w-[1100px]">
            <THead>
              <TR>
                <TH className="w-12" />
                <TH>{t("employees.full_name")}</TH>
                <TH>{t("leaves.type")}</TH>
                <TH>{t("leaves.salary_impact")}</TH>
                <TH className="text-right">{t("leaves.col_used")}</TH>
                <TH className="text-right">{t("leaves.col_max")}</TH>
                <TH className="text-right">{t("leaves.col_remaining")}</TH>
                <TH className="text-right">{t("leaves.payout_total")}</TH>
                <TH>{t("leaves.col_progress")}</TH>
              </TR>
            </THead>
            <TBody>
              {sortedFlat.map((r) => {
                const cap = r.max_days_per_year;
                const overCap = cap != null && r.used_days > cap;
                const pct =
                  cap != null && cap > 0
                    ? Math.min(100, (r.used_days / cap) * 100)
                    : null;
                return (
                  <TR
                    key={`${r.employee_id}|${r.leave_type_id}`}
                    className={cn(overCap && "bg-rose-50/40")}
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
                          {initials(r.full_name)}
                        </span>
                      )}
                    </TD>
                    <TD className="font-medium">
                      <div className="text-sm">{r.full_name}</div>
                      <div className="text-[11px] text-slate-400">{r.employee_code}</div>
                    </TD>
                    <TD>
                      <span className="text-sm">{r.leave_type_name}</span>
                    </TD>
                    <TD>
                      <Badge tone={r.paid ? "success" : "default"}>
                        <Coins className="mr-0.5 inline size-3" />
                        {r.paid ? t("leaves.paid") : t("leaves.unpaid")}
                      </Badge>
                    </TD>
                    <TD
                      className={cn(
                        "text-right tabular-nums",
                        overCap && "font-semibold text-rose-700"
                      )}
                    >
                      {r.used_days}
                    </TD>
                    <TD className="text-right tabular-nums text-slate-500">
                      {cap ?? "∞"}
                    </TD>
                    <TD
                      className={cn(
                        "text-right tabular-nums font-semibold",
                        r.remaining == null
                          ? "text-slate-400"
                          : r.remaining <= 0
                          ? "text-rose-700"
                          : r.remaining <= 3
                          ? "text-amber-700"
                          : "text-emerald-700"
                      )}
                    >
                      {r.remaining ?? "—"}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {r.paid && Number(r.total_paid_amount) > 0 ? (
                        <span className="text-sm font-semibold text-emerald-700">
                          {fmtMoney(Number(r.total_paid_amount))}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </TD>
                    <TD>
                      {pct != null ? (
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-full max-w-[140px] overflow-hidden rounded-full bg-slate-100">
                            <div
                              className={cn(
                                "h-full rounded-full transition-all",
                                overCap
                                  ? "bg-rose-500"
                                  : pct >= 80
                                  ? "bg-amber-500"
                                  : "bg-emerald-500"
                              )}
                              style={{ width: `${Math.min(100, pct)}%` }}
                            />
                          </div>
                          <span className="text-[10px] tabular-nums text-slate-500">
                            {Math.round(pct)}%
                          </span>
                          {overCap && (
                            <AlertTriangle className="size-3.5 text-rose-500" />
                          )}
                        </div>
                      ) : (
                        <span className="text-[10px] text-slate-400">
                          {t("leaves.no_cap")}
                        </span>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </div>
      ) : (
        <div className="space-y-4">
          {byEmployee.map(([empId, group]) => (
            <div
              key={empId}
              className="overflow-hidden rounded-lg border border-slate-200 bg-white"
            >
              <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
                {group.photo_url ? (
                  <img
                    src={group.photo_url}
                    alt=""
                    className="size-9 rounded-full object-cover ring-1 ring-slate-200"
                  />
                ) : (
                  <span className="flex size-9 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">
                    {initials(group.full_name)}
                  </span>
                )}
                <div>
                  <div className="text-sm font-semibold text-slate-800">
                    {group.full_name}
                  </div>
                  <div className="text-xs text-slate-400">{group.employee_code}</div>
                </div>
              </div>
              <Table>
                <THead>
                  <TR>
                    <TH>{t("leaves.type")}</TH>
                    <TH>{t("leaves.salary_impact")}</TH>
                    <TH className="text-right">{t("leaves.col_used")}</TH>
                    <TH className="text-right">{t("leaves.col_max")}</TH>
                    <TH className="text-right">{t("leaves.col_remaining")}</TH>
                    <TH className="text-right">{t("leaves.payout_total")}</TH>
                    <TH>{t("leaves.col_progress")}</TH>
                  </TR>
                </THead>
                <TBody>
                  {group.rows.map((r) => {
                    const cap = r.max_days_per_year;
                    const overCap =
                      cap != null && r.used_days > cap;
                    const pct =
                      cap != null && cap > 0
                        ? Math.min(100, (r.used_days / cap) * 100)
                        : null;
                    return (
                      <TR key={r.leave_type_id}>
                        <TD className="font-medium">{r.leave_type_name}</TD>
                        <TD>
                          <Badge tone={r.paid ? "success" : "default"}>
                            <Coins className="mr-0.5 inline size-3" />
                            {r.paid ? t("leaves.paid") : t("leaves.unpaid")}
                          </Badge>
                        </TD>
                        <TD className="text-right tabular-nums">{r.used_days}</TD>
                        <TD className="text-right tabular-nums text-slate-500">
                          {cap ?? "∞"}
                        </TD>
                        <TD
                          className={cn(
                            "text-right tabular-nums font-semibold",
                            r.remaining == null
                              ? "text-slate-400"
                              : r.remaining <= 0
                              ? "text-rose-700"
                              : r.remaining <= 3
                              ? "text-amber-700"
                              : "text-emerald-700"
                          )}
                        >
                          {r.remaining ?? "—"}
                        </TD>
                        <TD className="text-right tabular-nums">
                          {r.paid && Number(r.total_paid_amount) > 0 ? (
                            <span className="text-sm font-semibold text-emerald-700">
                              {fmtMoney(Number(r.total_paid_amount))}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </TD>
                        <TD>
                          {pct != null ? (
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-full max-w-[120px] overflow-hidden rounded-full bg-slate-100">
                                <div
                                  className={cn(
                                    "h-full rounded-full transition-all",
                                    overCap
                                      ? "bg-rose-500"
                                      : pct >= 80
                                      ? "bg-amber-500"
                                      : "bg-emerald-500"
                                  )}
                                  style={{ width: `${Math.min(100, pct)}%` }}
                                />
                              </div>
                              <span className="text-[10px] tabular-nums text-slate-500">
                                {Math.round(pct)}%
                              </span>
                            </div>
                          ) : (
                            <span className="text-[10px] text-slate-400">
                              {t("leaves.no_cap")}
                            </span>
                          )}
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Tile({
  tone,
  label,
  value,
}: {
  tone: "emerald" | "slate" | "rose" | "brand";
  label: string;
  value: string;
}) {
  const cls = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
    slate: "border-slate-200 bg-slate-50 text-slate-700",
    rose: "border-rose-200 bg-rose-50 text-rose-800",
    brand: "border-brand-200 bg-brand-50 text-brand-800",
  }[tone];
  return (
    <div className={cn("rounded-lg border px-4 py-3", cls)}>
      <div className="text-[10px] uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-0.5 text-base font-bold tabular-nums">{value}</div>
    </div>
  );
}
