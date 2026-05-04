import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Check,
  Crown,
  Layers,
  Sparkles,
  X,
} from "lucide-react";

import { api } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { useEnumLabel } from "@/lib/enum";
import { cn } from "@/lib/cn";
import type { CompanyPlan, PlanInfo } from "@/lib/types";

const PLAN_ACCENT: Record<
  CompanyPlan,
  { ring: string; bg: string; text: string; icon: React.ReactNode }
> = {
  FREE: {
    ring: "ring-slate-200",
    bg: "bg-white",
    text: "text-slate-800",
    icon: <Sparkles className="size-5 text-slate-500" />,
  },
  PRO: {
    ring: "ring-brand-300",
    bg: "bg-gradient-to-br from-brand-50 to-brand-100",
    text: "text-brand-800",
    icon: <Sparkles className="size-5 text-brand-500" />,
  },
  ENTERPRISE: {
    ring: "ring-amber-300",
    bg: "bg-gradient-to-br from-amber-50 to-yellow-100",
    text: "text-amber-900",
    icon: <Crown className="size-5 text-amber-500" />,
  },
};

const FEATURE_KEYS = [
  "attendance_basic",
  "attendance_face_id",
  "attendance_geofence",
  "shifts",
  "leaves",
  "salary",
  "kpi",
  "bonuses_deductions",
  "monthly_reports",
  "csv_export",
  "audit_log",
  "api_access",
  "telegram_notifications",
  "white_label",
  "priority_support",
] as const;

const LIMIT_KEYS = [
  "branches",
  "employees",
  "devices",
  "kpi_templates",
  "audit_retention_days",
  "api_rate_per_min",
] as const;

export function PlansPage() {
  const { t, i18n } = useTranslation();
  const label = useEnumLabel();

  const plansQ = useQuery({
    queryKey: ["plans"],
    queryFn: async () => (await api.get<PlanInfo[]>("/plans")).data,
    staleTime: 5 * 60_000,
  });

  const plans = plansQ.data ?? [];

  const fmtPrice = (p: number) => {
    if (p === 0) return null;
    return new Intl.NumberFormat(i18n.language).format(p);
  };

  const fmtLimit = (n: number | null) =>
    n === null
      ? <span className="inline-flex items-center gap-1 text-emerald-700"><Sparkles className="size-3" /> ∞</span>
      : n === 0
        ? <span className="text-rose-500">—</span>
        : <span className="font-mono tabular-nums">{n.toLocaleString()}</span>;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("plans_page.title")}
        breadcrumbs={[{ label: t("plans_page.title") }]}
        icon={<Layers className="size-5" />}
        description={t("plans_page.subtitle")}
      />

      {plansQ.isLoading ? (
        <p className="text-sm text-slate-500">{t("common.loading")}</p>
      ) : (
        <>
          {/* 3 plan cards */}
          <div className="grid gap-4 lg:grid-cols-3">
            {plans.map((p) => {
              const accent = PLAN_ACCENT[p.plan];
              const isPro = p.plan === "PRO";
              return (
                <div
                  key={p.plan}
                  className={cn(
                    "relative rounded-2xl p-6 ring-1 transition",
                    accent.ring,
                    accent.bg,
                    isPro && "lg:-translate-y-1 shadow-lg ring-2"
                  )}
                >
                  {isPro && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-brand-600 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-white shadow">
                      {t("plans_page.popular")}
                    </span>
                  )}
                  <div className="flex items-center gap-2">
                    {accent.icon}
                    <h3 className={cn("text-lg font-bold", accent.text)}>
                      {label("company_plan", p.plan)}
                    </h3>
                  </div>
                  <div className="mt-3">
                    {p.plan === "ENTERPRISE" ? (
                      <div>
                        <div className={cn("text-2xl font-bold", accent.text)}>
                          {t("plans_page.contact_us")}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {t("plans_page.contact_us_hint")}
                        </div>
                      </div>
                    ) : fmtPrice(p.price_uzs) ? (
                      <div>
                        <div className="flex items-baseline gap-1">
                          <span className={cn("text-3xl font-bold tabular-nums", accent.text)}>
                            {fmtPrice(p.price_uzs)}
                          </span>
                          <span className="text-sm text-slate-500">
                            {t("plans_page.uzs_per_month")}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className={cn("text-2xl font-bold", accent.text)}>
                        {t("plans_page.free")}
                      </div>
                    )}
                  </div>

                  {/* Top-level limits */}
                  <ul className="mt-5 space-y-2 text-sm">
                    <LimitRow
                      label={t("plans_page.limit_branches")}
                      value={fmtLimit(p.limits.branches ?? null)}
                    />
                    <LimitRow
                      label={t("plans_page.limit_employees")}
                      value={fmtLimit(p.limits.employees ?? null)}
                    />
                    <LimitRow
                      label={t("plans_page.limit_devices")}
                      value={fmtLimit(p.limits.devices ?? null)}
                    />
                  </ul>

                  {/* Top features */}
                  <ul className="mt-4 space-y-1.5">
                    {["salary", "kpi", "audit_log", "api_access", "telegram_notifications", "priority_support"].map(
                      (k) => {
                        const on = p.features[k];
                        return (
                          <li
                            key={k}
                            className={cn(
                              "flex items-center gap-2 text-xs",
                              on ? "text-slate-700" : "text-slate-400"
                            )}
                          >
                            {on ? (
                              <Check className="size-3.5 text-emerald-600" />
                            ) : (
                              <X className="size-3.5 text-slate-300" />
                            )}
                            {t(`plans_page.feature_${k}`)}
                          </li>
                        );
                      }
                    )}
                  </ul>
                </div>
              );
            })}
          </div>

          {/* Full features comparison table */}
          <div className="rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-4 py-3">
              <h3 className="text-sm font-semibold text-slate-800">
                {t("plans_page.full_comparison")}
              </h3>
              <p className="text-[11px] text-slate-500">
                {t("plans_page.full_comparison_hint")}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      {t("plans_page.col_feature")}
                    </th>
                    {plans.map((p) => (
                      <th
                        key={p.plan}
                        className="px-4 py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-500"
                      >
                        {label("company_plan", p.plan)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {/* Limits section */}
                  <tr>
                    <td
                      colSpan={plans.length + 1}
                      className="bg-slate-50/50 px-4 py-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-600"
                    >
                      {t("plans_page.limits_header")}
                    </td>
                  </tr>
                  {LIMIT_KEYS.map((k) => (
                    <tr
                      key={k}
                      className="border-b border-slate-100 last:border-b-0"
                    >
                      <td className="px-4 py-2 text-xs text-slate-700">
                        {t(`plans_page.limit_${k}`)}
                      </td>
                      {plans.map((p) => (
                        <td
                          key={p.plan}
                          className="px-4 py-2 text-center text-xs"
                        >
                          {fmtLimit(p.limits[k] ?? null)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {/* Features section */}
                  <tr>
                    <td
                      colSpan={plans.length + 1}
                      className="bg-slate-50/50 px-4 py-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-600"
                    >
                      {t("plans_page.features_header")}
                    </td>
                  </tr>
                  {FEATURE_KEYS.map((k) => (
                    <tr
                      key={k}
                      className="border-b border-slate-100 last:border-b-0"
                    >
                      <td className="px-4 py-2 text-xs text-slate-700">
                        {t(`plans_page.feature_${k}`)}
                      </td>
                      {plans.map((p) => (
                        <td
                          key={p.plan}
                          className="px-4 py-2 text-center"
                        >
                          {p.features[k] ? (
                            <Check className="mx-auto size-4 text-emerald-600" />
                          ) : (
                            <X className="mx-auto size-4 text-slate-300" />
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {t("plans_page.payment_note")}
          </div>
        </>
      )}
    </div>
  );
}

function LimitRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <li className="flex items-center justify-between border-b border-slate-200/50 pb-1.5 last:border-b-0 last:pb-0">
      <span className="text-xs text-slate-600">{label}</span>
      <span className="text-xs font-semibold">{value}</span>
    </li>
  );
}
