"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import {
  Calendar,
  CheckCircle2,
  Coins,
  Download,
  Loader2,
  Minus,
  Plus,
  Sparkles,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

import { api, apiErrorMessage } from "@/lib/api";
import { fmtMoney, fmtMoneyZero, fmtMonthLabel } from "@/lib/format";
import { cn } from "@/lib/cn";
import type {
  PeriodStatus,
  SalaryPeriod,
  SalaryTodaySnapshot,
} from "@/lib/types";

const STATUS_TONE: Record<
  PeriodStatus,
  "default" | "info" | "success" | "warning"
> = {
  DRAFT: "default",
  FINALIZED: "info",
  APPROVED: "info",
  PARTIALLY_PAID: "warning",
  PAID: "success",
};

const TONE_CLASS = {
  default: "bg-slate-100 text-slate-700 ring-slate-200",
  info: "bg-sky-100 text-sky-800 ring-sky-200",
  success: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  warning: "bg-amber-100 text-amber-800 ring-amber-200",
};

export default function SalaryPage() {
  const { t, i18n } = useTranslation();

  const todayQ = useQuery({
    queryKey: ["salary", "me", "today"],
    queryFn: async () =>
      (await api.get<SalaryTodaySnapshot>("/salary/me/today")).data,
    refetchInterval: 60_000,
  });

  const historyQ = useQuery({
    queryKey: ["salary", "me", "history"],
    queryFn: async () =>
      (await api.get<SalaryPeriod[]>("/salary/me/history")).data,
  });

  const snapshot = todayQ.data;
  const history = historyQ.data ?? [];
  const today = snapshot?.today;
  const period = snapshot?.period;

  const [downloading, setDownloading] = useState<string | null>(null);
  const downloadMonthlyPdf = async (year: number, month: number) => {
    const key = `${year}-${month}`;
    setDownloading(key);
    try {
      const r = await api.get<Blob>("/reports/me/monthly", {
        params: { year, month },
        responseType: "blob",
      });
      // Trigger a real download via a temporary link — the browser's
      // download manager handles the file save dialog. This is what users
      // expect on both desktop and PWA.
      const blobUrl = URL.createObjectURL(
        new Blob([r.data], { type: "application/pdf" })
      );
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `monthly_${year}-${String(month).padStart(2, "0")}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke after a short delay so the download has time to start.
      setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000);
    } catch (e) {
      toast.error(apiErrorMessage(e));
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-2 pt-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">{t("salary.title")}</h1>
          {period && (
            <p className="mt-0.5 text-xs text-slate-500">
              {fmtMonthLabel(period.year, period.month, i18n.language)}
            </p>
          )}
        </div>
        {period && (
          <button
            type="button"
            onClick={() => downloadMonthlyPdf(period.year, period.month)}
            disabled={downloading === `${period.year}-${period.month}`}
            className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 ring-1 ring-rose-200 disabled:opacity-50"
          >
            {downloading === `${period.year}-${period.month}` ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Download className="size-3.5" />
            )}
            {t("salary.download_pdf")}
          </button>
        )}
      </header>

      {/* Big period hero */}
      {todayQ.isLoading ? (
        <p className="py-4 text-center text-sm text-slate-500">
          {t("common.loading")}
        </p>
      ) : !period ? (
        <div className="card flex flex-col items-center gap-2 p-10 text-center">
          <Coins className="size-8 text-slate-300" />
          <p className="text-sm font-medium text-slate-600">
            {t("salary.no_period")}
          </p>
        </div>
      ) : (
        <>
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-500 to-emerald-700 p-5 text-white shadow-sm">
            <div className="absolute -right-8 -top-8 size-40 rounded-full bg-white/10 blur-2xl" />
            <div className="relative">
              <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider opacity-80">
                <Sparkles className="size-3.5" />
                {t("salary.stat_total")}
              </div>
              <div className="mt-1 text-3xl font-bold tabular-nums">
                {fmtMoneyZero(period.total_earned)}
              </div>
              {/* Status pill */}
              <span
                className={cn(
                  "mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ring-1",
                  TONE_CLASS[STATUS_TONE[period.status]]
                )}
              >
                {t(`salary.status_${period.status.toLowerCase()}`)}
              </span>
            </div>
          </div>

          {/* Today / Paid / Pending tiles */}
          <div className="grid grid-cols-3 gap-2">
            <Tile
              tone="brand"
              icon={<Sparkles className="size-3.5" />}
              label={t("salary.stat_today")}
              value={fmtMoneyZero(today?.total_earned ?? 0)}
            />
            <Tile
              tone="emerald"
              icon={<CheckCircle2 className="size-3.5" />}
              label={t("salary.stat_paid")}
              value={fmtMoneyZero(period.paid_amount)}
            />
            <Tile
              tone="amber"
              icon={<Wallet className="size-3.5" />}
              label={t("salary.stat_pending")}
              value={fmtMoneyZero(snapshot?.pending_amount ?? 0)}
            />
          </div>

          {/* Period breakdown */}
          <div className="card space-y-1.5 p-4">
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {t("salary.current_month")}
            </h2>
            <Row
              icon={<Coins className="size-3.5 text-slate-500" />}
              label={t("salary.base")}
              value={fmtMoney(period.base_amount)}
            />
            <Row
              icon={<TrendingUp className="size-3.5 text-emerald-600" />}
              label={t("salary.overtime")}
              value={fmtMoney(period.overtime_amount)}
              tone="emerald"
            />
            <Row
              icon={<Plus className="size-3.5 text-emerald-600" />}
              label={t("salary.bonuses")}
              value={fmtMoney(period.bonuses_total)}
              tone="emerald"
            />
            <Row
              icon={<Sparkles className="size-3.5 text-brand-600" />}
              label={t("salary.kpi_amount")}
              value={fmtMoney(period.kpi_amount)}
              tone="brand"
            />
            <Row
              icon={<Minus className="size-3.5 text-rose-600" />}
              label={t("salary.deductions")}
              value={
                Number(period.deductions_total) > 0
                  ? `−${fmtMoney(period.deductions_total)}`
                  : "—"
              }
              tone="rose"
            />
          </div>

          {/* Today breakdown */}
          {today && (
            <div className="card space-y-1.5 p-4">
              <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t("salary.today_breakdown")}
              </h2>
              <Row
                icon={<Coins className="size-3.5 text-slate-500" />}
                label={t("salary.hours_worked")}
                value={`${Number(today.hours_worked).toFixed(1)}h`}
              />
              {Number(today.overtime_hours) > 0 && (
                <Row
                  icon={<TrendingUp className="size-3.5 text-emerald-600" />}
                  label={t("salary.ot_hours")}
                  value={`${Number(today.overtime_hours).toFixed(1)}h`}
                />
              )}
              <Row
                icon={<Coins className="size-3.5 text-slate-500" />}
                label={t("salary.base")}
                value={fmtMoney(today.base_earned)}
              />
              {Number(today.overtime_earned) > 0 && (
                <Row
                  icon={<TrendingUp className="size-3.5 text-emerald-600" />}
                  label={t("salary.overtime")}
                  value={fmtMoney(today.overtime_earned)}
                  tone="emerald"
                />
              )}
              {Number(today.bonuses_earned) > 0 && (
                <Row
                  icon={<Plus className="size-3.5 text-emerald-600" />}
                  label={t("salary.bonuses")}
                  value={fmtMoney(today.bonuses_earned)}
                  tone="emerald"
                />
              )}
              {Number(today.deductions) > 0 && (
                <Row
                  icon={<Minus className="size-3.5 text-rose-600" />}
                  label={t("salary.deductions")}
                  value={`−${fmtMoney(today.deductions)}`}
                  tone="rose"
                />
              )}
            </div>
          )}
        </>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="card p-4">
          <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <Calendar className="size-3.5" />
            {t("salary.history_title")}
          </h2>
          <ul className="divide-y divide-slate-200">
            {history.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-2 py-2 first:pt-0 last:pb-0"
              >
                <div>
                  <div className="text-sm font-semibold text-slate-800">
                    {fmtMonthLabel(p.year, p.month, i18n.language)}
                  </div>
                  <span
                    className={cn(
                      "mt-0.5 inline-block rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ring-1",
                      TONE_CLASS[STATUS_TONE[p.status]]
                    )}
                  >
                    {t(`salary.status_${p.status.toLowerCase()}`)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-right">
                    <div className="font-mono text-sm font-bold tabular-nums text-slate-900">
                      {fmtMoneyZero(p.total_earned)}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {t("salary.stat_paid")}: {fmtMoney(p.paid_amount)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => downloadMonthlyPdf(p.year, p.month)}
                    disabled={downloading === `${p.year}-${p.month}`}
                    aria-label={t("salary.download_pdf")}
                    className="rounded-full p-1.5 text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                  >
                    {downloading === `${p.year}-${p.month}` ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Download className="size-4" />
                    )}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Tile({
  tone,
  icon,
  label,
  value,
}: {
  tone: "emerald" | "amber" | "brand";
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  const cls = {
    emerald: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    amber: "bg-amber-50 text-amber-800 ring-amber-200",
    brand: "bg-brand-50 text-brand-800 ring-brand-200",
  }[tone];
  return (
    <div className={cn("rounded-xl px-3 py-2.5 ring-1", cls)}>
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide opacity-70">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 text-base font-bold tabular-nums leading-tight">
        {value}
      </div>
    </div>
  );
}

function Row({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "emerald" | "rose" | "brand";
}) {
  const valueCls = tone
    ? {
        emerald: "text-emerald-700",
        rose: "text-rose-700",
        brand: "text-brand-700",
      }[tone]
    : "text-slate-900";
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="flex items-center gap-1.5 text-slate-600">
        {icon}
        {label}
      </span>
      <span className={cn("font-mono font-semibold tabular-nums", valueCls)}>
        {value}
      </span>
    </div>
  );
}
