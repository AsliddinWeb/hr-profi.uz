import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Calendar,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Coins,
  CreditCard,
  Edit2,
  Gift,
  Receipt,
  RefreshCw,
  Sparkles,
  TrendingUp,
  Wallet,
  Wand2,
} from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/Table";
import { PageHeader } from "@/components/PageHeader";
import { useEnumLabel } from "@/lib/enum";
import { cn } from "@/lib/cn";
import type {
  Employee,
  EmployeeBreakdown,
  PeriodStatus,
} from "@/lib/types";

import { fmtMoney, fmtMoneyZero, monthLabel } from "./utils";

type SubTab = "daily" | "bonuses" | "deductions" | "transactions" | "leaves";

function statusTone(s: PeriodStatus): "default" | "info" | "success" {
  if (s === "PAID") return "success";
  if (s === "FINALIZED") return "info";
  return "default";
}

export function EmployeeBreakdownPage() {
  const { t, i18n } = useTranslation();
  const label = useEnumLabel();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const today = new Date();
  const year = Number(params.get("year") ?? today.getFullYear());
  const month = Number(params.get("month") ?? today.getMonth() + 1);

  const setMonthAndYear = (y: number, m: number) => {
    const p = new URLSearchParams(params);
    p.set("year", String(y));
    p.set("month", String(m));
    setParams(p, { replace: true });
  };

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
    setMonthAndYear(y, m);
  };

  const empQ = useQuery({
    queryKey: ["employees", id],
    queryFn: async () => (await api.get<Employee>(`/employees/${id}`)).data,
    enabled: !!id,
  });

  const breakdownQ = useQuery({
    queryKey: ["salary", "breakdown", id, year, month],
    queryFn: async () =>
      (
        await api.get<EmployeeBreakdown>(
          `/salary/employee/${id}/breakdown`,
          { params: { year, month } }
        )
      ).data,
    enabled: !!id,
    refetchInterval: 30_000,
    staleTime: 0,
  });

  const recomputeMut = useMutation({
    mutationFn: async () =>
      api.post(`/salary/recompute-bulk`, null, {
        params: { year, month, employee_id: id },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["salary"] }),
  });

  const approveMut = useMutation({
    mutationFn: async (periodId: string) =>
      api.post(`/salary/${periodId}/approve`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["salary"] }),
  });

  const markPaidMut = useMutation({
    mutationFn: async (periodId: string) =>
      api.post(`/salary/${periodId}/mark-paid`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["salary"] }),
  });

  const reopenMut = useMutation({
    mutationFn: async (periodId: string) =>
      api.post(`/salary/${periodId}/reopen`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["salary"] }),
  });

  const [tab, setTab] = useState<SubTab>("daily");

  const emp = empQ.data;
  const breakdown = breakdownQ.data;
  const period = breakdown?.period ?? null;
  const status = (period?.status ?? "DRAFT") as PeriodStatus;

  const totals = useMemo(() => {
    return {
      base: Number(period?.base_amount) || 0,
      overtime: Number(period?.overtime_amount) || 0,
      bonuses: Number(period?.bonuses_total) || 0,
      kpi: Number(period?.kpi_amount) || 0,
      deductions: Number(period?.deductions_total) || 0,
      total: Number(period?.total_earned) || 0,
      paid: Number(period?.paid_amount) || 0,
      pending:
        (Number(period?.total_earned) || 0) -
        (Number(period?.paid_amount) || 0),
    };
  }, [period]);

  if (!id) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={emp?.full_name ?? t("salary_page.detail")}
        breadcrumbs={[
          { label: t("salary_page.title"), to: "/app/salary" },
          { label: emp?.full_name ?? t("salary_page.detail") },
        ]}
        icon={<Coins className="size-5" />}
        description={
          emp ? (
            <span>
              {emp.position ?? "—"} ·{" "}
              <code className="font-mono text-xs">{emp.employee_code}</code> ·{" "}
              {label("salary_type", emp.salary_type)}
            </span>
          ) : undefined
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="ghost" onClick={() => nav("/app/salary")}>
              <ArrowLeft className="size-4" />
              {t("common.back")}
            </Button>
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
            <Button
              type="button"
              variant="secondary"
              onClick={() => recomputeMut.mutate()}
              loading={recomputeMut.isPending}
            >
              <RefreshCw className="size-4" />
              {t("salary_page.recompute")}
            </Button>
            {period &&
              (period.status === "DRAFT" || period.status === "FINALIZED") && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    if (
                      window.confirm(
                        t("salary_page.approve_confirm", {
                          name: emp?.full_name ?? "",
                        }) ?? "Approve?"
                      )
                    ) {
                      approveMut.mutate(period.id);
                    }
                  }}
                  loading={approveMut.isPending}
                >
                  <CheckCircle2 className="size-4" />
                  {t("salary_page.approve")}
                </Button>
              )}
            {period &&
              (period.status === "APPROVED" ||
                period.status === "FINALIZED" ||
                period.status === "PARTIALLY_PAID") && (
                <Button
                  type="button"
                  variant="success"
                  onClick={() => {
                    if (
                      window.confirm(
                        t("salary_page.mark_paid_confirm", {
                          name: emp?.full_name ?? "",
                        }) ?? "Mark paid?"
                      )
                    ) {
                      markPaidMut.mutate(period.id);
                    }
                  }}
                  loading={markPaidMut.isPending}
                >
                  <CheckCircle2 className="size-4" />
                  {t("salary_page.mark_paid")}
                </Button>
              )}
            {period && period.status === "APPROVED" && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  if (
                    window.confirm(t("salary_page.reopen_confirm") ?? "Reopen?")
                  ) {
                    reopenMut.mutate(period.id);
                  }
                }}
                loading={reopenMut.isPending}
              >
                {t("salary_page.reopen")}
              </Button>
            )}
            {period && (
              <Link
                to={`/app/salary/transactions/new?employee_id=${id}&period_id=${period.id}`}
                className="btn-primary inline-flex items-center gap-1.5"
              >
                <CreditCard className="size-4" />
                {t("salary_page.record_payment")}
              </Link>
            )}
          </div>
        }
      />

      {/* Hero — money summary */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <div className="space-y-4 p-6">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Tile label={t("salary_page.base")} value={fmtMoneyZero(totals.base)} />
              <Tile
                label={t("salary_page.overtime")}
                value={fmtMoneyZero(totals.overtime)}
                tone="emerald"
              />
              <Tile
                label={t("salary_page.bonuses")}
                value={fmtMoneyZero(totals.bonuses)}
                tone="emerald"
              />
              <Tile
                label={t("salary_page.kpi")}
                value={fmtMoneyZero(totals.kpi)}
                tone="brand"
              />
              <Tile
                label={t("salary_page.deductions")}
                value={`-${fmtMoneyZero(totals.deductions)}`}
                tone="rose"
              />
              <Tile
                label={t("salary_page.total")}
                value={fmtMoneyZero(totals.total)}
                tone="emerald"
                primary
              />
            </div>
          </div>
        </Card>
        <Card>
          <div className="space-y-4 p-6">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <Sparkles className="size-3.5" />
              {t("salary_page.payout_summary")}
            </div>
            <div className="rounded-lg bg-gradient-to-br from-amber-50 to-amber-100/70 p-4">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-700/80">
                {t("salary_page.pending")}
              </div>
              <div className="mt-1 text-2xl font-bold tabular-nums text-amber-900">
                {fmtMoneyZero(totals.pending)}{" "}
                <span className="text-xs font-medium text-amber-700/80">
                  {t("employees.currency_short")}
                </span>
              </div>
            </div>
            <div className="space-y-1.5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">{t("salary_page.total")}</span>
                <span className="tabular-nums font-medium">
                  {fmtMoneyZero(totals.total)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">{t("salary_page.paid")}</span>
                <span className="tabular-nums">{fmtMoneyZero(totals.paid)}</span>
              </div>
              <div className="flex items-center justify-between border-t border-slate-100 pt-1.5">
                <span className="text-slate-500">{t("salary_page.status")}</span>
                {period ? (
                  <Badge tone={statusTone(status)}>
                    {label("period_status", status)}
                  </Badge>
                ) : (
                  <Badge tone="default">—</Badge>
                )}
              </div>
              {period?.finalized_at && (
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>{t("salary_page.finalized_at")}</span>
                  <span className="tabular-nums">
                    {new Date(period.finalized_at).toLocaleDateString(i18n.language)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap border-b border-slate-200">
        <SubTabBtn
          active={tab === "daily"}
          icon={<CalendarDays className="size-3.5" />}
          label={`${t("salary_page.tab_daily")} (${breakdown?.daily.length ?? 0})`}
          onClick={() => setTab("daily")}
        />
        <SubTabBtn
          active={tab === "bonuses"}
          icon={<Gift className="size-3.5" />}
          label={`${t("salary_page.tab_bonuses")} (${breakdown?.bonuses.length ?? 0})`}
          onClick={() => setTab("bonuses")}
        />
        <SubTabBtn
          active={tab === "deductions"}
          icon={<Receipt className="size-3.5" />}
          label={`${t("salary_page.tab_deductions")} (${breakdown?.deductions.length ?? 0})`}
          onClick={() => setTab("deductions")}
        />
        <SubTabBtn
          active={tab === "leaves"}
          icon={<Calendar className="size-3.5" />}
          label={`${t("salary_page.tab_leaves")} (${breakdown?.leaves.length ?? 0})`}
          onClick={() => setTab("leaves")}
        />
        <SubTabBtn
          active={tab === "transactions"}
          icon={<CreditCard className="size-3.5" />}
          label={`${t("salary_page.tab_transactions")} (${breakdown?.transactions.length ?? 0})`}
          onClick={() => setTab("transactions")}
        />
      </div>

      {breakdownQ.isLoading ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          {t("common.loading")}
        </div>
      ) : breakdownQ.isError ? (
        <p className="text-sm text-red-600">{apiErrorMessage(breakdownQ.error)}</p>
      ) : (
        <>
          {tab === "daily" && <DailyTable rows={breakdown?.daily ?? []} />}
          {tab === "bonuses" && (
            <BonusList rows={breakdown?.bonuses ?? []} employeeId={id} />
          )}
          {tab === "deductions" && (
            <DeductionList rows={breakdown?.deductions ?? []} employeeId={id} />
          )}
          {tab === "leaves" && <LeavesList rows={breakdown?.leaves ?? []} />}
          {tab === "transactions" && (
            <TransactionsList
              rows={breakdown?.transactions ?? []}
              employeeId={id}
              periodId={period?.id}
            />
          )}
        </>
      )}
    </div>
  );
}

// ---------------- Sub-tabs --------------------------------------------------

function DailyTable({ rows }: { rows: EmployeeBreakdown["daily"] }) {
  const { t, i18n } = useTranslation();
  if (rows.length === 0) {
    return (
      <Empty hint={t("salary_page.daily_empty")} />
    );
  }
  return (
    <Table className="min-w-[900px]">
      <THead>
        <TR>
          <TH>{t("attendance.when")}</TH>
          <TH className="text-right">{t("salary_page.col_hours")}</TH>
          <TH className="text-right">{t("salary_page.col_overtime_hours")}</TH>
          <TH className="text-right">{t("salary_page.base")}</TH>
          <TH className="text-right">{t("salary_page.overtime")}</TH>
          <TH className="text-right">{t("salary_page.bonuses")}</TH>
          <TH className="text-right">{t("salary_page.kpi")}</TH>
          <TH className="text-right">{t("salary_page.deductions")}</TH>
          <TH className="text-right">{t("salary_page.total")}</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((r) => {
          const dt = new Date(r.date);
          const dow = dt.toLocaleDateString(i18n.language, { weekday: "short" });
          const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
          return (
            <TR key={r.id} className={cn(isWeekend && "bg-slate-50/50")}>
              <TD className="text-sm">
                <div className="font-medium">{dt.toLocaleDateString(i18n.language)}</div>
                <div className="text-[10px] uppercase text-slate-400">{dow}</div>
              </TD>
              <TD className="text-right tabular-nums text-slate-700">
                {Number(r.hours_worked) > 0 ? Number(r.hours_worked).toFixed(2) : "—"}
              </TD>
              <TD className="text-right tabular-nums text-emerald-700">
                {Number(r.overtime_hours) > 0 ? Number(r.overtime_hours).toFixed(2) : "—"}
              </TD>
              <TD className="text-right tabular-nums">{fmtMoney(r.base_earned)}</TD>
              <TD className="text-right tabular-nums text-emerald-700">
                {fmtMoney(r.overtime_earned)}
              </TD>
              <TD className="text-right tabular-nums text-emerald-700">
                {fmtMoney(r.bonuses_earned)}
              </TD>
              <TD className="text-right tabular-nums text-brand-700">
                {fmtMoney(r.kpi_earned)}
              </TD>
              <TD className="text-right tabular-nums text-rose-700">
                {Number(r.deductions) > 0 ? `−${fmtMoney(r.deductions)}` : "—"}
              </TD>
              <TD className="text-right tabular-nums font-semibold">
                {fmtMoney(r.total_earned)}
              </TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}

function BonusList({
  rows,
  employeeId,
}: {
  rows: EmployeeBreakdown["bonuses"];
  employeeId: string;
}) {
  const { t, i18n } = useTranslation();
  const label = useEnumLabel();
  if (rows.length === 0) {
    return <Empty hint={t("salary_page.bonuses_empty")} actionTo={`/app/employees/${employeeId}/edit`} actionLabel={t("salary_page.go_to_employee")} />;
  }
  return (
    <Table className="min-w-[700px]">
      <THead>
        <TR>
          <TH>{t("leaves.type")}</TH>
          <TH>{t("attendance.when")}</TH>
          <TH>{t("leaves.reason")}</TH>
          <TH className="text-right">{t("employees.amount")}</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((b) => (
          <TR key={b.id}>
            <TD>
              <div className="flex items-center gap-1.5">
                <Badge tone={b.type === "KPI" ? "info" : "success"}>
                  {label("bonus_type", b.type)}
                </Badge>
                {b.auto_generated && (
                  <Badge tone="default">
                    <Wand2 className="mr-0.5 inline size-3" /> {t("employees.auto")}
                  </Badge>
                )}
              </div>
            </TD>
            <TD className="text-xs text-slate-600 tabular-nums">
              {new Date(b.applied_date).toLocaleDateString(i18n.language)}
            </TD>
            <TD className="text-xs text-slate-600">
              {b.reason || <span className="text-slate-400">—</span>}
            </TD>
            <TD className="text-right tabular-nums font-semibold text-emerald-700">
              +{fmtMoney(b.amount)}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

function DeductionList({
  rows,
  employeeId,
}: {
  rows: EmployeeBreakdown["deductions"];
  employeeId: string;
}) {
  const { t, i18n } = useTranslation();
  const label = useEnumLabel();
  if (rows.length === 0) {
    return <Empty hint={t("salary_page.deductions_empty")} actionTo={`/app/employees/${employeeId}/edit`} actionLabel={t("salary_page.go_to_employee")} />;
  }
  return (
    <Table className="min-w-[700px]">
      <THead>
        <TR>
          <TH>{t("leaves.type")}</TH>
          <TH>{t("attendance.when")}</TH>
          <TH>{t("leaves.reason")}</TH>
          <TH className="text-right">{t("employees.amount")}</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((d) => (
          <TR key={d.id}>
            <TD>
              <div className="flex items-center gap-1.5">
                <Badge tone={d.type === "PENALTY" ? "danger" : "warning"}>
                  {label("deduction_type", d.type)}
                </Badge>
                {d.auto_generated && (
                  <Badge tone="default">
                    <Wand2 className="mr-0.5 inline size-3" /> {t("employees.auto")}
                  </Badge>
                )}
              </div>
            </TD>
            <TD className="text-xs text-slate-600 tabular-nums">
              {new Date(d.applied_date).toLocaleDateString(i18n.language)}
            </TD>
            <TD className="text-xs text-slate-600">
              {d.reason || <span className="text-slate-400">—</span>}
            </TD>
            <TD className="text-right tabular-nums font-semibold text-rose-700">
              −{fmtMoney(d.amount)}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

function LeavesList({ rows }: { rows: EmployeeBreakdown["leaves"] }) {
  const { t, i18n } = useTranslation();
  const label = useEnumLabel();
  if (rows.length === 0) {
    return <Empty hint={t("salary_page.leaves_empty")} />;
  }
  return (
    <Table className="min-w-[800px]">
      <THead>
        <TR>
          <TH>{t("leaves.type")}</TH>
          <TH>{t("leaves.dates")}</TH>
          <TH className="text-right">{t("leaves.days")}</TH>
          <TH>{t("leaves.salary_impact")}</TH>
          <TH>{t("leaves.status")}</TH>
          <TH className="text-right">{t("leaves.payout_total")}</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((lr) => (
          <TR key={lr.id}>
            <TD>
              <span className="text-sm font-medium">{lr.leave_type_name}</span>
            </TD>
            <TD className="text-xs text-slate-600 tabular-nums">
              {new Date(lr.start_date).toLocaleDateString(i18n.language)} →{" "}
              {new Date(lr.end_date).toLocaleDateString(i18n.language)}
            </TD>
            <TD className="text-right font-mono">{lr.days}</TD>
            <TD>
              <Badge tone={lr.paid ? "success" : "default"}>
                <Coins className="mr-0.5 inline size-3" />
                {lr.paid ? t("leaves.paid") : t("leaves.unpaid")}
              </Badge>
            </TD>
            <TD>
              <Badge
                tone={
                  lr.status === "APPROVED"
                    ? "success"
                    : lr.status === "PENDING"
                    ? "warning"
                    : lr.status === "REJECTED"
                    ? "danger"
                    : "default"
                }
              >
                {label("leave_status", lr.status)}
              </Badge>
            </TD>
            <TD className="text-right tabular-nums">
              {lr.override_amount ? (
                <span className="inline-flex items-center gap-1 font-semibold text-amber-700">
                  <Edit2 className="size-3" />
                  {fmtMoney(lr.override_amount)}
                </span>
              ) : (
                <span className="text-slate-400">—</span>
              )}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

function TransactionsList({
  rows,
  employeeId,
  periodId,
}: {
  rows: EmployeeBreakdown["transactions"];
  employeeId: string;
  periodId?: string;
}) {
  const { t, i18n } = useTranslation();
  const label = useEnumLabel();
  if (rows.length === 0) {
    return (
      <Empty
        hint={t("salary_page.transactions_empty")}
        actionTo={`/app/salary/transactions/new?employee_id=${employeeId}${periodId ? `&period_id=${periodId}` : ""}`}
        actionLabel={t("salary_page.record_payment")}
      />
    );
  }
  return (
    <Table className="min-w-[800px]">
      <THead>
        <TR>
          <TH>{t("attendance.when")}</TH>
          <TH>{t("leaves.type")}</TH>
          <TH>{t("salary_page.payment_method")}</TH>
          <TH>{t("salary_page.payment_reference")}</TH>
          <TH className="text-right">{t("employees.amount")}</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((tx) => (
          <TR key={tx.id}>
            <TD className="text-xs text-slate-600 tabular-nums">
              {new Date(tx.paid_at).toLocaleDateString(i18n.language)}
            </TD>
            <TD>
              <Badge
                tone={
                  tx.type === "ADVANCE"
                    ? "warning"
                    : tx.type === "FULL_PAYMENT"
                    ? "success"
                    : "info"
                }
              >
                {label("transaction_type", tx.type)}
              </Badge>
            </TD>
            <TD className="text-xs text-slate-600">{tx.payment_method ?? "—"}</TD>
            <TD className="text-xs text-slate-600">{tx.reference ?? "—"}</TD>
            <TD className="text-right tabular-nums font-semibold">
              {fmtMoney(tx.amount)}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

// ---------------- Helpers ---------------------------------------------------

function SubTabBtn({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition",
        active
          ? "border-brand-500 text-brand-700"
          : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function Tile({
  label,
  value,
  tone = "slate",
  primary,
}: {
  label: string;
  value: string;
  tone?: "slate" | "emerald" | "rose" | "brand";
  primary?: boolean;
}) {
  const cls = {
    slate: "bg-slate-50 ring-slate-200 text-slate-700",
    emerald: "bg-emerald-50 ring-emerald-200 text-emerald-800",
    rose: "bg-rose-50 ring-rose-200 text-rose-800",
    brand: "bg-brand-50 ring-brand-200 text-brand-800",
  }[tone];
  return (
    <div className={cn("rounded-md px-3 py-2.5 ring-1", cls, primary && "ring-2 ring-emerald-500")}>
      <div className="text-[10px] uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-0.5 text-base font-bold tabular-nums">{value}</div>
    </div>
  );
}

function Empty({
  hint,
  actionTo,
  actionLabel,
}: {
  hint: string;
  actionTo?: string;
  actionLabel?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-500">
      <p>{hint}</p>
      {actionTo && actionLabel && (
        <Link
          to={actionTo}
          className="mt-3 inline-flex items-center gap-1 rounded-md bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-100"
        >
          {actionLabel}
        </Link>
      )}
    </div>
  );
}

void TrendingUp;
void Wallet;
