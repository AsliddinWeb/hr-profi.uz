import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Building2,
  Clock,
  Crown,
  LayoutDashboard,
  Layers,
  Plus,
  Sparkles,
  Store,
  TrendingUp,
  Users,
} from "lucide-react";

import { api } from "@/lib/api";
import { Card, CardSubtitle, CardTitle } from "@/components/ui/Card";
import { PageHeader } from "@/components/PageHeader";
import { useAuthStore } from "@/stores/auth";
import { useEnumLabel } from "@/lib/enum";
import { cn } from "@/lib/cn";
import type { CompanyPlan, OwnerStats } from "@/lib/types";

export function OwnerDashboard() {
  const { t, i18n } = useTranslation();
  const label = useEnumLabel();
  const user = useAuthStore((s) => s.user);

  const statsQ = useQuery({
    queryKey: ["owner", "stats"],
    queryFn: async () => (await api.get<OwnerStats>("/owner/stats")).data,
    refetchInterval: 60_000,
  });

  const s = statsQ.data;
  const totalPlans = s
    ? Math.max(
        1,
        (s.by_plan.FREE ?? 0) +
          (s.by_plan.PRO ?? 0) +
          (s.by_plan.ENTERPRISE ?? 0)
      )
    : 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span>
            {t("owner.dashboard_title")},{" "}
            <span className="text-brand-700">
              {user?.full_name || user?.username}
            </span>
          </span>
        }
        description={t("owner.dashboard_subtitle")}
        breadcrumbs={[{ label: t("nav.dashboard") }]}
        icon={<LayoutDashboard className="size-5" />}
        actions={
          <Link
            to="/owner/companies/new"
            className="btn-primary inline-flex items-center gap-1.5"
          >
            <Plus className="size-4" />
            {t("owner.create_company")}
          </Link>
        }
      />

      {statsQ.isLoading || !s ? (
        <p className="text-sm text-slate-500">{t("common.loading")}</p>
      ) : (
        <>
          {/* Top counts */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile
              tone="brand"
              icon={<Building2 className="size-4" />}
              label={t("owner.stat_active_companies")}
              value={s.companies.active}
              hint={`/ ${s.companies.total} ${t("owner.stat_total_short")}`}
              to="/owner/companies"
            />
            <StatTile
              tone="rose"
              icon={<AlertTriangle className="size-4" />}
              label={t("owner.stat_suspended")}
              value={s.companies.suspended}
              to="/owner/companies"
            />
            <StatTile
              tone="emerald"
              icon={<Sparkles className="size-4" />}
              label={t("owner.stat_new_30d")}
              value={s.companies.new_30d}
              hint={t("owner.stat_new_30d_hint") ?? undefined}
            />
            <StatTile
              tone="indigo"
              icon={<Users className="size-4" />}
              label={t("owner.stat_users")}
              value={s.users}
            />
            <StatTile
              tone="amber"
              icon={<Store className="size-4" />}
              label={t("owner.stat_branches")}
              value={s.branches}
            />
            <StatTile
              tone="slate"
              icon={<TrendingUp className="size-4" />}
              label={t("owner.stat_employees")}
              value={s.employees}
            />
          </div>

          {/* Plan distribution + recent companies */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <div className="card-header">
                <div>
                  <CardTitle>{t("owner.plan_distribution")}</CardTitle>
                  <CardSubtitle>{t("owner.plan_distribution_hint")}</CardSubtitle>
                </div>
                <Link
                  to="/owner/plans"
                  className="text-xs font-semibold text-brand-700 hover:underline"
                >
                  {t("owner.view_plans")}
                </Link>
              </div>
              <div className="card-body space-y-3">
                {(["FREE", "PRO", "ENTERPRISE"] as CompanyPlan[]).map((p) => {
                  const count = s.by_plan[p] ?? 0;
                  const pct = Math.round((count / totalPlans) * 100);
                  return (
                    <div key={p}>
                      <div className="flex items-baseline justify-between text-xs">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 font-semibold",
                            p === "ENTERPRISE"
                              ? "text-amber-700"
                              : p === "PRO"
                                ? "text-brand-700"
                                : "text-slate-700"
                          )}
                        >
                          {p === "ENTERPRISE" ? (
                            <Crown className="size-3" />
                          ) : (
                            <Sparkles className="size-3" />
                          )}
                          {label("company_plan", p)}
                        </span>
                        <span className="tabular-nums text-slate-500">
                          {count} · {pct}%
                        </span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={cn(
                            "h-full rounded-full",
                            p === "ENTERPRISE"
                              ? "bg-gradient-to-r from-amber-400 to-amber-600"
                              : p === "PRO"
                                ? "bg-brand-500"
                                : "bg-slate-400"
                          )}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card>
              <div className="card-header">
                <div>
                  <CardTitle>{t("owner.recent_companies")}</CardTitle>
                  <CardSubtitle>{t("owner.recent_companies_hint")}</CardSubtitle>
                </div>
                <Link
                  to="/owner/companies"
                  className="text-xs font-semibold text-brand-700 hover:underline"
                >
                  {t("owner.view_all")}
                </Link>
              </div>
              <div className="card-body">
                {s.recent.length === 0 ? (
                  <p className="py-4 text-center text-xs text-slate-400">
                    {t("common.no_data")}
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {s.recent.map((c) => (
                      <li key={c.id}>
                        <Link
                          to={`/owner/companies/${c.id}/edit`}
                          className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 transition hover:border-brand-300 hover:bg-brand-50/30"
                        >
                          <div className="flex items-center gap-2">
                            <span className="flex size-7 items-center justify-center rounded-md bg-slate-100 text-slate-500">
                              <Building2 className="size-3.5" />
                            </span>
                            <div>
                              <div className="text-sm font-semibold text-slate-800">
                                {c.name}
                              </div>
                              <code className="text-[10px] text-slate-400">
                                {c.slug}
                              </code>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ring-1",
                                c.plan === "ENTERPRISE"
                                  ? "bg-amber-50 text-amber-700 ring-amber-200"
                                  : c.plan === "PRO"
                                    ? "bg-brand-50 text-brand-700 ring-brand-200"
                                    : "bg-slate-100 text-slate-700 ring-slate-200"
                              )}
                            >
                              {label("company_plan", c.plan)}
                            </span>
                            <span className="text-[10px] tabular-nums text-slate-400">
                              {c.created_at
                                ? new Date(c.created_at).toLocaleDateString(
                                    i18n.language
                                  )
                                : "—"}
                            </span>
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>
          </div>

          {/* Expiring soon */}
          {s.expiring_soon.length > 0 && (
            <Card>
              <div className="card-header">
                <div>
                  <CardTitle>
                    <span className="inline-flex items-center gap-1.5">
                      <Clock className="size-4 text-amber-500" />
                      {t("owner.expiring_soon")}
                    </span>
                  </CardTitle>
                  <CardSubtitle>{t("owner.expiring_soon_hint")}</CardSubtitle>
                </div>
              </div>
              <div className="card-body">
                <ul className="space-y-1.5">
                  {s.expiring_soon.map((c) => {
                    const daysLeft = c.subscription_until
                      ? Math.ceil(
                          (new Date(c.subscription_until).getTime() -
                            Date.now()) /
                            (1000 * 60 * 60 * 24)
                        )
                      : null;
                    const tone =
                      daysLeft != null && daysLeft <= 3
                        ? "border-rose-200 bg-rose-50 text-rose-700"
                        : daysLeft != null && daysLeft <= 7
                          ? "border-amber-200 bg-amber-50 text-amber-700"
                          : "border-sky-200 bg-sky-50 text-sky-700";
                    return (
                      <li key={c.id}>
                        <Link
                          to={`/owner/companies/${c.id}/edit`}
                          className={cn(
                            "flex items-center justify-between rounded-md border px-3 py-2",
                            tone
                          )}
                        >
                          <div>
                            <div className="text-sm font-semibold">
                              {c.name}
                            </div>
                            <code className="text-[10px] opacity-70">
                              {c.slug}
                            </code>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-bold tabular-nums">
                              {c.subscription_until
                                ? new Date(
                                    c.subscription_until
                                  ).toLocaleDateString(i18n.language)
                                : "—"}
                            </div>
                            {daysLeft != null && (
                              <div className="text-[10px] opacity-80">
                                {daysLeft >= 0
                                  ? t("owner.days_left", { days: daysLeft })
                                  : t("owner.expired")}
                              </div>
                            )}
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </Card>
          )}

          {/* Quick links */}
          <Card>
            <div className="card-header">
              <CardTitle>{t("dashboard.quick_links")}</CardTitle>
            </div>
            <div className="card-body grid gap-2 sm:grid-cols-3">
              <QuickLink
                to="/owner/companies/new"
                icon={<Plus className="size-4" />}
                label={t("owner.create_company")}
              />
              <QuickLink
                to="/owner/companies"
                icon={<Building2 className="size-4" />}
                label={t("owner.companies_title")}
              />
              <QuickLink
                to="/owner/plans"
                icon={<Layers className="size-4" />}
                label={t("plans_page.title")}
              />
            </div>
          </Card>
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
  tone: "brand" | "emerald" | "amber" | "rose" | "indigo" | "slate";
  icon: React.ReactNode;
  label: string;
  value: number;
  hint?: React.ReactNode;
  to?: string;
}) {
  const cls = {
    brand: "border-brand-200 bg-brand-50 text-brand-800",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    rose: "border-rose-200 bg-rose-50 text-rose-800",
    indigo: "border-indigo-200 bg-indigo-50 text-indigo-800",
    slate: "border-slate-200 bg-white text-slate-700",
  }[tone];
  const inner = (
    <div
      className={cn(
        "rounded-lg border px-3 py-2.5 transition",
        cls,
        to && "hover:scale-[1.02]"
      )}
    >
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide opacity-70">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums leading-none">
        {value.toLocaleString()}
      </div>
      {hint && <div className="mt-1 text-[10px] opacity-70">{hint}</div>}
    </div>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
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
      className="group flex items-center gap-2.5 rounded-xl border border-slate-200 p-3 transition hover:border-brand-200 hover:bg-brand-50/30"
    >
      <span className="flex size-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600 group-hover:bg-brand-100">
        {icon}
      </span>
      <span className="text-sm font-medium text-slate-800">{label}</span>
    </Link>
  );
}
