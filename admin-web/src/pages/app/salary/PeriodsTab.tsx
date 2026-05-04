import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BadgeCheck,
  Banknote,
  Building2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronRight as ChevR,
  Coins,
  HandCoins,
  Lock,
  RefreshCw,
  Search,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/Table";
import { useEnumLabel } from "@/lib/enum";
import { cn } from "@/lib/cn";
import type {
  Branch,
  BulkActionResult,
  BulkRecomputeResult,
  Department,
  Page,
  PeriodStatus,
  PeriodWithEmployee,
  SalaryDashboardSummary,
} from "@/lib/types";

import { fmtMoney, fmtMoneyZero, initials, monthLabel } from "./utils";

type SortKey =
  | "name"
  | "total_desc"
  | "total_asc"
  | "pending_desc"
  | "status";

type StatusFilter = "" | PeriodStatus;

function statusTone(
  s: PeriodStatus
): "default" | "info" | "success" | "warning" {
  if (s === "PAID") return "success";
  if (s === "PARTIALLY_PAID") return "warning";
  if (s === "APPROVED") return "info";
  if (s === "FINALIZED") return "info";
  return "default";
}

export function PeriodsTab() {
  const { t, i18n } = useTranslation();
  const label = useEnumLabel();
  const nav = useNavigate();
  const qc = useQueryClient();

  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [query, setQuery] = useState("");
  const [branchFilter, setBranchFilter] = useState<string>("all");
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [sortKey, setSortKey] = useState<SortKey>("name");

  const branchesQ = useQuery({
    queryKey: ["branches", "for-salary"],
    queryFn: async () =>
      (await api.get<Page<Branch>>("/branches", { params: { size: 200 } })).data,
  });
  const deptsQ = useQuery({
    queryKey: ["departments", "for-salary"],
    queryFn: async () =>
      (await api.get<Page<Department>>("/departments", { params: { size: 200 } })).data,
  });

  const periodsQ = useQuery({
    queryKey: ["salary", "periods", year, month, branchFilter, deptFilter],
    queryFn: async () => {
      const params: Record<string, string | number> = { year, month };
      if (branchFilter !== "all") params.branch_id = branchFilter;
      if (deptFilter !== "all") params.department_id = deptFilter;
      return (
        await api.get<PeriodWithEmployee[]>("/salary/periods", { params })
      ).data;
    },
    refetchInterval: 30_000,
    staleTime: 0,
  });

  const recomputeBulkMut = useMutation({
    mutationFn: async () => {
      const params: Record<string, string | number> = { year, month };
      if (branchFilter !== "all") params.branch_id = branchFilter;
      return (
        await api.post<BulkRecomputeResult>("/salary/recompute-bulk", null, { params })
      ).data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["salary"] }),
  });

  const recomputeOneMut = useMutation({
    mutationFn: async (employeeId: string) => {
      const params = { year, month };
      return (
        await api.post<BulkRecomputeResult>("/salary/recompute-bulk", null, {
          params: { ...params, employee_id: employeeId },
        })
      ).data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["salary"] }),
  });

  const approveMut = useMutation({
    mutationFn: async (periodId: string) =>
      api.post(`/salary/${periodId}/approve`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["salary"] }),
    onError: (e) => alert(apiErrorMessage(e)),
  });

  const markPaidMut = useMutation({
    mutationFn: async (periodId: string) =>
      api.post(`/salary/${periodId}/mark-paid`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["salary"] }),
    onError: (e) => alert(apiErrorMessage(e)),
  });

  const bulkApproveMut = useMutation({
    mutationFn: async () =>
      (
        await api.post<BulkActionResult>("/salary/bulk/approve", null, {
          params: { year, month },
        })
      ).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["salary"] }),
    onError: (e) => alert(apiErrorMessage(e)),
  });

  const bulkMarkPaidMut = useMutation({
    mutationFn: async () =>
      (
        await api.post<BulkActionResult>("/salary/bulk/mark-paid", null, {
          params: { year, month },
        })
      ).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["salary"] }),
    onError: (e) => alert(apiErrorMessage(e)),
  });

  const summaryQ = useQuery({
    queryKey: ["salary", "dashboard", year, month],
    queryFn: async () =>
      (
        await api.get<SalaryDashboardSummary>("/salary/dashboard/summary", {
          params: { year, month },
        })
      ).data,
    refetchInterval: 30_000,
    staleTime: 0,
  });

  const branches = branchesQ.data?.items ?? [];
  const allDepts = deptsQ.data?.items ?? [];
  const deptOptions = useMemo(
    () =>
      branchFilter === "all"
        ? allDepts
        : allDepts.filter((d) => d.branch_id === branchFilter),
    [allDepts, branchFilter]
  );

  const rows = periodsQ.data ?? [];

  // Per-branch employee counts. Show every branch — even ones with no
  // employees in the current month — so the chip strip is the same on
  // every page load and the admin can filter to an empty branch and see
  // "—" rather than a missing chip.
  const branchCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      if (!r.branch_id) continue;
      map.set(r.branch_id, (map.get(r.branch_id) ?? 0) + 1);
    }
    return map;
  }, [rows]);
  const visibleBranches = branches;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = rows.filter((r) => {
      if (statusFilter) {
        const s = r.period?.status ?? "DRAFT";
        if (s !== statusFilter) return false;
      }
      if (q) {
        if (
          !r.full_name.toLowerCase().includes(q) &&
          !r.employee_code.toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
    const statusRank: Record<string, number> = {
      DRAFT: 0,
      FINALIZED: 1,
      APPROVED: 2,
      PARTIALLY_PAID: 3,
      PAID: 4,
    };
    list = [...list];
    list.sort((a, b) => {
      const at = a.period ? Number(a.period.total_earned) : 0;
      const bt = b.period ? Number(b.period.total_earned) : 0;
      const ap = Number(a.pending_amount) || 0;
      const bp = Number(b.pending_amount) || 0;
      const as = a.period?.status ?? "DRAFT";
      const bs = b.period?.status ?? "DRAFT";
      switch (sortKey) {
        case "total_desc":
          return bt - at || a.full_name.localeCompare(b.full_name);
        case "total_asc":
          return at - bt || a.full_name.localeCompare(b.full_name);
        case "pending_desc":
          return bp - ap || a.full_name.localeCompare(b.full_name);
        case "status":
          return (
            (statusRank[as] ?? 9) - (statusRank[bs] ?? 9) ||
            a.full_name.localeCompare(b.full_name)
          );
        default:
          return a.full_name.localeCompare(b.full_name);
      }
    });
    return list;
  }, [rows, statusFilter, query, sortKey]);

  const stats = useMemo(() => {
    const out = {
      employees: rows.length,
      total: 0,
      paid: 0,
      pending: 0,
      finalized: 0,
      drafts: 0,
      paidPeriods: 0,
    };
    for (const r of rows) {
      const total = r.period ? Number(r.period.total_earned) : 0;
      const paid = r.period ? Number(r.period.paid_amount) : 0;
      out.total += total;
      out.paid += paid;
      out.pending += Number(r.pending_amount) || 0;
      const status = r.period?.status ?? null;
      if (status === "FINALIZED") out.finalized += 1;
      if (status === "DRAFT") out.drafts += 1;
      if (status === "PAID") out.paidPeriods += 1;
    }
    return out;
  }, [rows]);

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

  const exportCsv = () => {
    if (filtered.length === 0) return;
    const BOM = "﻿";
    const headers = [
      t("employees.code"),
      t("employees.full_name"),
      t("salary_page.base"),
      t("salary_page.overtime"),
      t("salary_page.bonuses"),
      t("salary_page.kpi"),
      t("salary_page.deductions"),
      t("salary_page.total"),
      t("salary_page.paid"),
      t("salary_page.pending"),
      t("salary_page.status"),
    ];
    const lines = filtered.map((r) => {
      const p = r.period;
      return [
        `"${r.employee_code}"`,
        `"${r.full_name.replace(/"/g, '""')}"`,
        Math.round(Number(p?.base_amount) || 0),
        Math.round(Number(p?.overtime_amount) || 0),
        Math.round(Number(p?.bonuses_total) || 0),
        Math.round(Number(p?.kpi_amount) || 0),
        Math.round(Number(p?.deductions_total) || 0),
        Math.round(Number(p?.total_earned) || 0),
        Math.round(Number(p?.paid_amount) || 0),
        Math.round(Number(r.pending_amount) || 0),
        p?.status ?? "—",
      ].join(",");
    });
    const blob = new Blob([BOM + [headers.join(","), ...lines].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payroll-${year}-${String(month).padStart(2, "0")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      {/* Branch chip strip — same UX as the attendance Live tab. Inactive
          branches still appear (greyed) so the admin can find historical
          data on a deactivated branch. */}
      <div className="flex flex-wrap items-center gap-2">
        <BranchChip
          active={branchFilter === "all"}
          onClick={() => {
            setBranchFilter("all");
            setDeptFilter("all");
          }}
          label={t("departments_page.branch_all")}
          count={rows.length}
          allChip
        />
        {visibleBranches.map((b) => (
          <BranchChip
            key={b.id}
            active={branchFilter === b.id}
            onClick={() => {
              setBranchFilter(b.id);
              setDeptFilter("all");
            }}
            label={b.name}
            count={branchCounts.get(b.id) ?? 0}
            disabled={!b.is_active}
          />
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
          <Button type="button" variant="ghost" size="sm" iconOnly onClick={() => stepMonth(-1)}>
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-[160px] text-center text-sm font-semibold capitalize text-slate-700">
            {monthLabel(year, month, i18n.language)}
          </span>
          <Button type="button" variant="ghost" size="sm" iconOnly onClick={() => stepMonth(1)}>
            <ChevronRight className="size-4" />
          </Button>
        </div>

        <div className="min-w-[200px] flex-1">
          <Input
            label={t("salary_page.search_label")}
            placeholder={t("salary_page.search_placeholder") ?? ""}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            prefix={<Search className="size-4" />}
          />
        </div>

        <div>
          <label className="label">{t("employees.department")}</label>
          <select
            className="input min-w-[140px]"
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
          >
            <option value="all">{t("departments_page.branch_all")}</option>
            {deptOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{t("salary_page.status")}</label>
          <select
            className="input min-w-[140px]"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          >
            <option value="">{t("branches.status_all")}</option>
            <option value="DRAFT">{label("period_status", "DRAFT")}</option>
            <option value="APPROVED">{label("period_status", "APPROVED")}</option>
            <option value="PARTIALLY_PAID">
              {label("period_status", "PARTIALLY_PAID")}
            </option>
            <option value="PAID">{label("period_status", "PAID")}</option>
          </select>
        </div>

        <div className="ml-auto flex items-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={exportCsv}
            disabled={filtered.length === 0}
          >
            {t("attendance.export_csv")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => recomputeBulkMut.mutate()}
            loading={recomputeBulkMut.isPending}
          >
            <RefreshCw className="size-4" />
            {t("salary_page.recompute_all")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              if (window.confirm(t("salary_page.bulk_approve_confirm") ?? "")) {
                bulkApproveMut.mutate();
              }
            }}
            loading={bulkApproveMut.isPending}
          >
            <BadgeCheck className="size-4" />
            {t("salary_page.bulk_approve")}
          </Button>
          <Button
            type="button"
            onClick={() => {
              if (window.confirm(t("salary_page.bulk_mark_paid_confirm") ?? "")) {
                bulkMarkPaidMut.mutate();
              }
            }}
            loading={bulkMarkPaidMut.isPending}
          >
            <Banknote className="size-4" />
            {t("salary_page.bulk_mark_paid")}
          </Button>
        </div>
      </div>

      {(bulkApproveMut.isSuccess || bulkMarkPaidMut.isSuccess) && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          <CheckCircle2 className="mr-1 inline size-3" />
          {t("salary_page.bulk_action_done", {
            affected:
              (bulkApproveMut.data?.affected ?? 0) +
              (bulkMarkPaidMut.data?.affected ?? 0),
          })}
        </div>
      )}

      {/* Financial summary */}
      <FinancialSummary
        summary={summaryQ.data}
        fallback={stats}
        currency={t("employees.currency_short")}
      />

      {/* Recompute feedback */}
      {recomputeBulkMut.isSuccess && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          <CheckCircle2 className="mr-1 inline size-3" />
          {t("salary_page.recompute_done", {
            employees: recomputeBulkMut.data?.queued_employees ?? 0,
            days: recomputeBulkMut.data?.days ?? 0,
          })}
        </div>
      )}
      {recomputeBulkMut.isError && (
        <p className="text-sm text-red-600">{apiErrorMessage(recomputeBulkMut.error)}</p>
      )}

      {/* Table */}
      <Table className="min-w-[1280px]">
        <THead>
          <TR>
            <TH className="w-12" />
            <TH>
              <SortHead
                label={t("salary_page.employee")}
                active={sortKey === "name"}
                onClick={() => setSortKey("name")}
              />
            </TH>
            <TH className="text-right">{t("salary_page.base")}</TH>
            <TH className="text-right">{t("salary_page.overtime")}</TH>
            <TH className="text-right">{t("salary_page.bonuses")}</TH>
            <TH className="text-right">{t("salary_page.kpi")}</TH>
            <TH className="text-right">{t("salary_page.deductions")}</TH>
            <TH className="text-right">
              <SortHead
                label={t("salary_page.total")}
                align="right"
                active={sortKey === "total_desc" || sortKey === "total_asc"}
                direction={sortKey === "total_asc" ? "asc" : "desc"}
                onClick={() =>
                  setSortKey(sortKey === "total_desc" ? "total_asc" : "total_desc")
                }
              />
            </TH>
            <TH className="text-right">{t("salary_page.paid")}</TH>
            <TH className="text-right">
              <SortHead
                label={t("salary_page.pending")}
                align="right"
                active={sortKey === "pending_desc"}
                onClick={() => setSortKey("pending_desc")}
              />
            </TH>
            <TH>
              <SortHead
                label={t("salary_page.status")}
                active={sortKey === "status"}
                onClick={() => setSortKey("status")}
              />
            </TH>
            <TH className="text-right">{t("common.actions")}</TH>
          </TR>
        </THead>
        <TBody>
          {periodsQ.isLoading ? (
            <TR>
              <TD colSpan={12} className="text-center text-sm text-slate-500">
                {t("common.loading")}
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
              const p = r.period;
              const status = (p?.status ?? "DRAFT") as PeriodStatus;
              return (
                <TR
                  key={r.employee_id}
                  className="cursor-pointer hover:bg-slate-50/70"
                  onClick={() =>
                    nav(`/app/salary/employee/${r.employee_id}?year=${year}&month=${month}`)
                  }
                >
                  <TD>
                    <div className="relative inline-block">
                      {r.photo_url ? (
                        <img
                          src={r.photo_url}
                          alt=""
                          className="size-9 rounded-full object-cover ring-1 ring-slate-200"
                        />
                      ) : (
                        <span className="flex size-9 items-center justify-center rounded-full bg-brand-50 text-[11px] font-semibold text-brand-700">
                          {initials(r.full_name)}
                        </span>
                      )}
                      {r.has_attendance_today && (
                        <span className="absolute -bottom-0.5 -right-0.5 flex size-2.5">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
                          <span className="relative inline-flex size-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />
                        </span>
                      )}
                    </div>
                  </TD>
                  <TD className="font-medium">
                    <div className="text-sm">{r.full_name}</div>
                    <div className="text-[11px] text-slate-400">
                      {r.position ?? r.employee_code}
                    </div>
                  </TD>
                  <TD className="text-right tabular-nums text-slate-700">
                    {fmtMoney(p?.base_amount ?? null)}
                  </TD>
                  <TD className="text-right tabular-nums text-emerald-700">
                    {fmtMoney(p?.overtime_amount ?? null)}
                  </TD>
                  <TD className="text-right tabular-nums text-emerald-700">
                    {fmtMoney(p?.bonuses_total ?? null)}
                  </TD>
                  <TD className="text-right tabular-nums text-brand-700">
                    {fmtMoney(p?.kpi_amount ?? null)}
                  </TD>
                  <TD className="text-right tabular-nums text-rose-700">
                    {p && Number(p.deductions_total) > 0
                      ? `−${fmtMoney(p.deductions_total)}`
                      : "—"}
                  </TD>
                  <TD className="text-right tabular-nums">
                    <span className="text-sm font-semibold text-slate-900">
                      {fmtMoney(p?.total_earned ?? null)}
                    </span>
                  </TD>
                  <TD className="text-right tabular-nums text-slate-600">
                    {fmtMoney(p?.paid_amount ?? null)}
                  </TD>
                  <TD className="text-right tabular-nums">
                    {Number(r.pending_amount) > 0 ? (
                      <span className="font-semibold text-amber-700">
                        {fmtMoney(r.pending_amount)}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </TD>
                  <TD>
                    {p ? (
                      <Badge tone={statusTone(status)}>
                        {label("period_status", status)}
                      </Badge>
                    ) : (
                      <Badge tone="default">—</Badge>
                    )}
                  </TD>
                  <TD
                    className="text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="inline-flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => recomputeOneMut.mutate(r.employee_id)}
                        loading={
                          recomputeOneMut.isPending &&
                          recomputeOneMut.variables === r.employee_id
                        }
                        title={t("salary_page.recompute") ?? undefined}
                      >
                        <RefreshCw className="size-3.5" />
                      </Button>
                      {/* Approve — DRAFT/FINALIZED → APPROVED (locks period) */}
                      {p &&
                        (p.status === "DRAFT" || p.status === "FINALIZED") && (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              if (
                                window.confirm(
                                  t("salary_page.approve_confirm", {
                                    name: r.full_name,
                                  }) ?? "Approve?"
                                )
                              ) {
                                approveMut.mutate(p.id);
                              }
                            }}
                            loading={
                              approveMut.isPending &&
                              approveMut.variables === p.id
                            }
                            title={t("salary_page.approve") ?? undefined}
                          >
                            <BadgeCheck className="size-3.5" />
                          </Button>
                        )}
                      {/* Mark paid — APPROVED/FINALIZED/PARTIALLY_PAID → PAID */}
                      {p &&
                        (p.status === "APPROVED" ||
                          p.status === "FINALIZED" ||
                          p.status === "PARTIALLY_PAID") && (
                          <Button
                            type="button"
                            variant="success"
                            size="sm"
                            onClick={() => {
                              if (
                                window.confirm(
                                  t("salary_page.mark_paid_confirm", {
                                    name: r.full_name,
                                  }) ?? "Mark paid?"
                                )
                              ) {
                                markPaidMut.mutate(p.id);
                              }
                            }}
                            loading={
                              markPaidMut.isPending &&
                              markPaidMut.variables === p.id
                            }
                            title={t("salary_page.mark_paid") ?? undefined}
                          >
                            <Banknote className="size-3.5" />
                          </Button>
                        )}
                      {/* PAID → small lock icon */}
                      {p && p.status === "PAID" && (
                        <span
                          title={t("salary_page.paid") ?? undefined}
                          className="inline-flex size-7 items-center justify-center rounded-md bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200"
                        >
                          <Lock className="size-3.5" />
                        </span>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        iconOnly
                        onClick={() =>
                          nav(`/app/salary/employee/${r.employee_id}?year=${year}&month=${month}`)
                        }
                      >
                        <ChevR className="size-4" />
                      </Button>
                    </div>
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

function SortHead({
  label,
  active,
  direction = "desc",
  align = "left",
  onClick,
}: {
  label: string;
  active?: boolean;
  direction?: "asc" | "desc";
  align?: "left" | "right";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide transition hover:text-brand-700",
        active ? "text-brand-700" : "text-slate-500",
        align === "right" && "flex-row-reverse"
      )}
    >
      {label}
      {active ? (
        direction === "asc" ? (
          <ArrowUp className="size-3" />
        ) : (
          <ArrowDown className="size-3" />
        )
      ) : (
        <ArrowUpDown className="size-3 opacity-40" />
      )}
    </button>
  );
}

function StatTile({
  tone = "slate",
  icon,
  label,
  value,
  suffix,
  hint,
}: {
  tone?: "slate" | "brand" | "emerald" | "amber" | "rose" | "indigo";
  icon: React.ReactNode;
  label: string;
  value: string;
  suffix?: string;
  hint?: string;
}) {
  const cls = {
    slate: "border-slate-200 bg-white text-slate-700",
    brand: "border-brand-200 bg-brand-50 text-brand-800",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    rose: "border-rose-200 bg-rose-50 text-rose-800",
    indigo: "border-indigo-200 bg-indigo-50 text-indigo-800",
  }[tone];
  return (
    <div className={cn("rounded-lg border px-3 py-2.5", cls)}>
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide opacity-70">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span className="text-base font-bold tabular-nums">{value}</span>
        {suffix && <span className="text-[10px] opacity-60">{suffix}</span>}
      </div>
      {hint && <div className="text-[10px] opacity-50">{hint}</div>}
    </div>
  );
}

/** Top-of-page financial state. Falls back to client-side aggregation when
 * the dashboard endpoint hasn't responded yet so the UI stays populated. */
function FinancialSummary({
  summary,
  fallback,
  currency,
}: {
  summary: SalaryDashboardSummary | undefined;
  fallback: {
    employees: number;
    total: number;
    paid: number;
    pending: number;
    drafts: number;
    finalized: number;
    paidPeriods: number;
  };
  currency: string;
}) {
  const { t } = useTranslation();
  const label = useEnumLabel();
  const employees = summary?.employees ?? fallback.employees;
  const totalEarned = Number(summary?.total_earned ?? fallback.total);
  const totalPaid = Number(summary?.total_paid ?? fallback.paid);
  const totalPending = Number(summary?.total_pending ?? fallback.pending);
  const advances = Number(summary?.advances_outstanding ?? 0);
  const bonuses = Number(summary?.bonuses_total ?? 0);
  const deductions = Number(summary?.deductions_total ?? 0);
  const kpiTotal = Number(summary?.kpi_total ?? 0);
  const overtime = Number(summary?.overtime_total ?? 0);
  const ytdPaid = Number(summary?.ytd_paid ?? 0);

  const byStatus = summary?.by_status ?? {};
  const topUnpaid = summary?.top_unpaid ?? [];

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-700">
          <Wallet className="size-4 text-brand-500" />
          {t("salary_page.financial_summary")}
        </h2>
        {ytdPaid > 0 && (
          <span className="text-[11px] tabular-nums text-slate-500">
            {t("salary_page.stat_ytd_paid")}:{" "}
            <strong className="text-slate-800">
              {fmtMoneyZero(ytdPaid)} {currency}
            </strong>
          </span>
        )}
      </header>

      {/* Tile grid */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-7">
        <StatTile
          icon={<Users className="size-4" />}
          label={t("salary_page.stat_employees")}
          value={String(employees)}
        />
        <StatTile
          tone="brand"
          icon={<Coins className="size-4" />}
          label={t("salary_page.stat_total")}
          value={fmtMoneyZero(totalEarned)}
          suffix={currency}
        />
        <StatTile
          tone="emerald"
          icon={<CheckCircle2 className="size-4" />}
          label={t("salary_page.stat_paid")}
          value={fmtMoneyZero(totalPaid)}
          suffix={currency}
        />
        <StatTile
          tone="amber"
          icon={<Wallet className="size-4" />}
          label={t("salary_page.stat_pending")}
          value={fmtMoneyZero(totalPending)}
          suffix={currency}
        />
        <StatTile
          tone="indigo"
          icon={<HandCoins className="size-4" />}
          label={t("salary_page.stat_advances_outstanding")}
          value={fmtMoneyZero(advances)}
          suffix={currency}
          hint={t("salary_page.advances_outstanding_hint") ?? undefined}
        />
        <StatTile
          tone="emerald"
          icon={<TrendingUp className="size-4" />}
          label={t("salary_page.stat_bonuses")}
          value={fmtMoneyZero(bonuses + kpiTotal + overtime)}
          suffix={currency}
          hint={`KPI ${fmtMoneyZero(kpiTotal)} / OT ${fmtMoneyZero(overtime)}`}
        />
        <StatTile
          tone="rose"
          icon={<TrendingUp className="size-4 -rotate-180" />}
          label={t("salary_page.stat_deductions")}
          value={fmtMoneyZero(deductions)}
          suffix={currency}
        />
      </div>

      {/* Status pills + top unpaid in a 2-col layout */}
      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-lg bg-slate-50 p-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            {t("salary_page.stat_status_breakdown")}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {Object.keys(byStatus).length === 0 ? (
              <span className="text-xs text-slate-400">—</span>
            ) : (
              Object.entries(byStatus).map(([s, c]) => (
                <span
                  key={s}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1",
                    s === "PAID"
                      ? "bg-emerald-100 text-emerald-800 ring-emerald-200"
                      : s === "APPROVED" || s === "FINALIZED"
                        ? "bg-sky-100 text-sky-800 ring-sky-200"
                        : s === "PARTIALLY_PAID"
                          ? "bg-amber-100 text-amber-800 ring-amber-200"
                          : "bg-slate-100 text-slate-700 ring-slate-200"
                  )}
                >
                  <span>{label("period_status", s)}</span>
                  <span className="rounded-full bg-white/70 px-1 text-[10px] tabular-nums">
                    {c}
                  </span>
                </span>
              ))
            )}
          </div>
        </div>

        <div className="rounded-lg bg-slate-50 p-3">
          <div className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            <span>{t("salary_page.top_unpaid")}</span>
            <span className="text-amber-700 normal-case tracking-normal">
              {topUnpaid.length}
            </span>
          </div>
          {topUnpaid.length === 0 ? (
            <p className="text-xs text-slate-400">—</p>
          ) : (
            <ul className="space-y-1">
              {topUnpaid.map((u) => (
                <li
                  key={u.employee_id}
                  className="flex items-center justify-between rounded-md bg-white px-2 py-1.5 ring-1 ring-slate-200"
                >
                  <div className="min-w-0 flex-1 pr-2">
                    <div className="truncate text-xs font-semibold text-slate-800">
                      {u.full_name}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {u.employee_code}
                    </div>
                  </div>
                  <span className="tabular-nums text-sm font-bold text-amber-700">
                    {fmtMoneyZero(u.pending_amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function BranchChip({
  active,
  onClick,
  label,
  count,
  allChip,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  allChip?: boolean;
  /** Inactive branch — still selectable, but visually muted with a strike. */
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition",
        active
          ? "border-brand-600 bg-brand-600 text-white shadow-sm shadow-brand-600/30"
          : "border-slate-200 bg-white text-slate-700 hover:-translate-y-0.5 hover:border-brand-300 hover:bg-brand-50/50 hover:text-brand-700 hover:shadow-sm",
        disabled && !active && "opacity-50 line-through"
      )}
    >
      {allChip ? (
        <Users className={cn("size-3.5", active ? "opacity-90" : "text-brand-500")} />
      ) : (
        <Building2 className={cn("size-3.5", active ? "opacity-90" : "text-slate-400")} />
      )}
      <span className="truncate max-w-[180px]">{label}</span>
      <span
        className={cn(
          "inline-flex min-w-[20px] items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums no-underline",
          active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-700"
        )}
      >
        {count}
      </span>
    </button>
  );
}
