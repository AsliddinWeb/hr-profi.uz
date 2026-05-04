"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Calendar, Star, Trophy } from "lucide-react";

import { api } from "@/lib/api";
import { fmtMoney, fmtMoneyZero, fmtMonthLabel } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { KPIAssignmentDetail } from "@/lib/types";

function scoreTone(s: number): {
  bg: string;
  text: string;
  ring: string;
  bar: string;
} {
  if (s >= 100)
    return {
      bg: "bg-emerald-50",
      text: "text-emerald-700",
      ring: "ring-emerald-200",
      bar: "bg-emerald-500",
    };
  if (s >= 80)
    return {
      bg: "bg-brand-50",
      text: "text-brand-700",
      ring: "ring-brand-200",
      bar: "bg-brand-500",
    };
  if (s >= 50)
    return {
      bg: "bg-amber-50",
      text: "text-amber-700",
      ring: "ring-amber-200",
      bar: "bg-amber-500",
    };
  return {
    bg: "bg-rose-50",
    text: "text-rose-700",
    ring: "ring-rose-200",
    bar: "bg-rose-500",
  };
}

const STATUS_TONE_CLS: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700",
  ACTIVE: "bg-sky-100 text-sky-800",
  COMPUTED: "bg-indigo-100 text-indigo-800",
  APPROVED: "bg-emerald-100 text-emerald-800",
  PAID: "bg-emerald-200 text-emerald-900",
  REJECTED: "bg-rose-100 text-rose-800",
  CANCELLED: "bg-slate-100 text-slate-500",
  COMPLETED: "bg-emerald-100 text-emerald-800",
};

export default function KpiPage() {
  const { t, i18n } = useTranslation();

  const meQ = useQuery({
    queryKey: ["kpi", "me"],
    queryFn: async () =>
      (await api.get<KPIAssignmentDetail[]>("/kpi/me")).data,
  });

  const historyQ = useQuery({
    queryKey: ["kpi", "me", "history"],
    queryFn: async () =>
      (
        await api.get<KPIAssignmentDetail[]>("/kpi/me/history", {
          params: { months: 12 },
        })
      ).data,
  });

  const currentMonth = meQ.data ?? [];
  const historyAll = historyQ.data ?? [];
  // History endpoint returns everything including current month — filter
  // out the current period rows so we don't double-show them.
  const today = new Date();
  const previousOnly = historyAll.filter(
    (a) => !(a.year === today.getFullYear() && a.month === today.getMonth() + 1)
  );

  const summary = currentMonth.reduce(
    (acc, a) => {
      acc.score += Number(a.score) || 0;
      if (!a.is_penalty) acc.reward += Number(a.computed_reward) || 0;
      return acc;
    },
    { score: 0, reward: 0 }
  );
  const avgScore =
    currentMonth.length > 0 ? summary.score / currentMonth.length : 0;

  return (
    <div className="space-y-4">
      <header className="pt-2">
        <h1 className="text-xl font-bold text-slate-900">{t("kpi.title")}</h1>
        <p className="mt-0.5 text-xs text-slate-500">{t("kpi.current_month")}</p>
      </header>

      {/* Summary tiles */}
      {currentMonth.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          <div
            className={cn(
              "rounded-xl px-3 py-2.5 ring-1",
              scoreTone(avgScore).bg,
              scoreTone(avgScore).text,
              scoreTone(avgScore).ring
            )}
          >
            <div className="text-[10px] font-semibold uppercase tracking-wide opacity-70">
              {t("kpi.score")}
            </div>
            <div className="text-2xl font-bold tabular-nums">
              {avgScore.toFixed(1)}%
            </div>
          </div>
          <div className="rounded-xl bg-emerald-50 px-3 py-2.5 ring-1 ring-emerald-200">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700/70">
              {t("kpi.reward")}
            </div>
            <div className="text-2xl font-bold tabular-nums text-emerald-800">
              {fmtMoneyZero(summary.reward)}
            </div>
          </div>
        </div>
      )}

      {/* Current month KPI cards */}
      {meQ.isLoading ? (
        <p className="py-4 text-center text-sm text-slate-500">
          {t("common.loading")}
        </p>
      ) : currentMonth.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 p-10 text-center">
          <Trophy className="size-8 text-slate-300" />
          <p className="text-sm font-medium text-slate-600">{t("kpi.no_kpi")}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {currentMonth.map((a) => (
            <KpiCard key={a.id} a={a} t={t} locale={i18n.language} />
          ))}
        </ul>
      )}

      {/* History — collapsed simple list of past months */}
      {previousOnly.length > 0 && (
        <div className="card p-4">
          <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <Calendar className="size-3.5" />
            {t("kpi.history_title")}
          </h2>
          <ul className="divide-y divide-slate-200">
            {previousOnly.slice(0, 12).map((a) => {
              const score = Number(a.score) || 0;
              const tone = scoreTone(score);
              return (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-2 py-2 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-800">
                      {a.template_name ?? "—"}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {fmtMonthLabel(a.year, a.month, i18n.language)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ring-1",
                        tone.bg,
                        tone.text,
                        tone.ring
                      )}
                    >
                      {score.toFixed(0)}%
                    </span>
                    {Number(a.computed_reward) > 0 && (
                      <span
                        className={cn(
                          "font-mono text-xs font-bold tabular-nums",
                          a.is_penalty ? "text-rose-700" : "text-emerald-700"
                        )}
                      >
                        {a.is_penalty ? "−" : "+"}
                        {fmtMoney(a.computed_reward)}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function KpiCard({
  a,
  t,
  locale,
}: {
  a: KPIAssignmentDetail;
  t: (k: string, opts?: Record<string, unknown>) => string;
  locale: string;
}) {
  const score = Number(a.score) || 0;
  const tone = scoreTone(score);
  const reward = Number(a.computed_reward) || 0;
  const progressPct = Math.min(100, Math.max(0, score));
  const statusCls = STATUS_TONE_CLS[a.status] ?? "bg-slate-100 text-slate-700";
  void locale;

  return (
    <li className="card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-slate-900">
            {a.template_name ?? "—"}
          </div>
          {a.template_category && (
            <div className="mt-0.5">
              <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-slate-600">
                {t(`kpi.category_${a.template_category.toLowerCase()}`)}
              </span>
            </div>
          )}
        </div>
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase",
            statusCls
          )}
        >
          {t(`kpi.status_${a.status.toLowerCase()}`)}
        </span>
      </div>

      {/* Score + progress */}
      <div className="mt-2.5">
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] uppercase tracking-wide text-slate-500">
            {t("kpi.score")}
          </span>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ring-1",
              tone.bg,
              tone.text,
              tone.ring
            )}
          >
            {score.toFixed(1)}%
          </span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
          <div
            className={cn("h-full rounded-full", tone.bar)}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Numbers row */}
      <div className="mt-3 grid grid-cols-3 gap-1 text-xs">
        <Mini label={t("kpi.actual")} value={`${Number(a.actual).toFixed(2)}${a.template_unit ? ` ${a.template_unit}` : ""}`} />
        <Mini label={t("kpi.target")} value={Number(a.target).toFixed(2)} />
        <Mini
          label={a.is_penalty ? t("kpi.penalty") : t("kpi.reward")}
          value={
            reward > 0
              ? `${a.is_penalty ? "−" : "+"}${fmtMoney(reward)}`
              : "—"
          }
          tone={a.is_penalty ? "rose" : "emerald"}
        />
      </div>

      {/* Manager review */}
      {(a.manager_rating || a.manager_comment) && (
        <div className="mt-3 rounded-md bg-amber-50 p-2 ring-1 ring-amber-200">
          {a.manager_rating && (
            <div className="flex items-center gap-1 text-xs">
              <Star className="size-3 fill-amber-500 text-amber-500" />
              <span className="font-semibold text-amber-900">
                {Number(a.manager_rating).toFixed(1)} / 5
              </span>
            </div>
          )}
          {a.manager_comment && (
            <p className="mt-1 text-[11px] text-amber-900">
              {a.manager_comment}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

function Mini({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "emerald" | "rose";
}) {
  const valueCls = tone
    ? { emerald: "text-emerald-700", rose: "text-rose-700" }[tone]
    : "text-slate-800";
  return (
    <div className="rounded-md bg-slate-50 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className={cn("mt-0.5 font-mono font-bold tabular-nums", valueCls)}>
        {value}
      </div>
    </div>
  );
}
