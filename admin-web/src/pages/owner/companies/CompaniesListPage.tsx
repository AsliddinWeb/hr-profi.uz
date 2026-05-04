import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Building2,
  Crown,
  ListChecks,
  PauseOctagon,
  Pencil,
  PlayCircle,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/Table";
import { PageHeader } from "@/components/PageHeader";
import { useEnumLabel } from "@/lib/enum";
import { cn } from "@/lib/cn";
import type { Company, CompanyPlan, Page } from "@/lib/types";

import { PLAN_TONE } from "./utils";

type LifecycleFilter = "all" | "active" | "suspended";
type PlanFilter = "all" | CompanyPlan;

const PLAN_FILTERS: CompanyPlan[] = ["FREE", "PRO", "ENTERPRISE"];

export function CompaniesListPage() {
  const { t, i18n } = useTranslation();
  const label = useEnumLabel();
  const nav = useNavigate();
  const qc = useQueryClient();

  const [lifecycleFilter, setLifecycleFilter] =
    useState<LifecycleFilter>("active");
  const [planFilter, setPlanFilter] = useState<PlanFilter>("all");
  const [query, setQuery] = useState("");

  const listQ = useQuery({
    queryKey: ["owner", "companies", lifecycleFilter, query],
    queryFn: async () => {
      const params: Record<string, string | boolean | number> = { size: 200 };
      if (lifecycleFilter === "active") params.is_active = true;
      if (lifecycleFilter === "suspended") params.is_active = false;
      if (query.trim()) params.q = query.trim();
      return (
        await api.get<Page<Company>>("/owner/companies", { params })
      ).data;
    },
    refetchInterval: 60_000,
  });

  const items = useMemo(() => {
    const xs = listQ.data?.items ?? [];
    if (planFilter === "all") return xs;
    return xs.filter((c) => c.plan === planFilter);
  }, [listQ.data, planFilter]);

  const stats = useMemo(() => {
    const all = listQ.data?.items ?? [];
    const out = {
      total: all.length,
      active: 0,
      suspended: 0,
      free: 0,
      pro: 0,
      enterprise: 0,
    };
    for (const c of all) {
      if (c.is_active) out.active += 1;
      else out.suspended += 1;
      if (c.plan === "FREE") out.free += 1;
      else if (c.plan === "PRO") out.pro += 1;
      else if (c.plan === "ENTERPRISE") out.enterprise += 1;
    }
    return out;
  }, [listQ.data]);

  const suspendMut = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/owner/companies/${id}/suspend`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["owner"] });
      toast.success(t("owner_companies.suspended_done"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const unsuspendMut = useMutation({
    mutationFn: async (id: string) =>
      api.post(`/owner/companies/${id}/unsuspend`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["owner"] });
      toast.success(t("owner_companies.unsuspended_done"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const hardDeleteMut = useMutation({
    mutationFn: async (id: string) => api.delete(`/owner/companies/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["owner"] });
      toast.success(t("owner_companies.deleted_done"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("owner.companies_title")}
        breadcrumbs={[{ label: t("owner.companies_title") }]}
        icon={<Building2 className="size-5" />}
        description={t("owner_companies.list_subtitle")}
        actions={
          <Button onClick={() => nav("/owner/companies/new")}>
            <Plus className="size-4" />
            {t("owner.create_company")}
          </Button>
        }
      />

      {/* Stats strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat
          tone="brand"
          icon={<Building2 className="size-4" />}
          label={t("owner_companies.stat_total")}
          value={stats.total}
        />
        <Stat
          tone="emerald"
          icon={<Power className="size-4" />}
          label={t("owner_companies.stat_active")}
          value={stats.active}
        />
        <Stat
          tone="rose"
          icon={<PowerOff className="size-4" />}
          label={t("owner_companies.stat_suspended")}
          value={stats.suspended}
        />
        <Stat
          tone="slate"
          icon={<Sparkles className="size-4" />}
          label="FREE"
          value={stats.free}
        />
        <Stat
          tone="brand"
          icon={<Sparkles className="size-4" />}
          label="PRO"
          value={stats.pro}
        />
        <Stat
          tone="amber"
          icon={<Crown className="size-4" />}
          label="ENTERPRISE"
          value={stats.enterprise}
        />
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        <Chip
          active={lifecycleFilter === "active"}
          onClick={() => setLifecycleFilter("active")}
          label={t("owner_companies.filter_active")}
          icon={<Power className="size-3.5" />}
        />
        <Chip
          active={lifecycleFilter === "suspended"}
          onClick={() => setLifecycleFilter("suspended")}
          label={t("owner_companies.filter_suspended")}
          icon={<PowerOff className="size-3.5" />}
        />
        <Chip
          active={lifecycleFilter === "all"}
          onClick={() => setLifecycleFilter("all")}
          label={t("owner_companies.filter_all")}
          icon={<ListChecks className="size-3.5" />}
        />
        <span className="mx-2 hidden h-6 w-px bg-slate-200 sm:inline-block" />
        <Chip
          active={planFilter === "all"}
          onClick={() => setPlanFilter("all")}
          label={t("owner_companies.plan_all")}
          icon={<Sparkles className="size-3.5" />}
        />
        {PLAN_FILTERS.map((p) => (
          <Chip
            key={p}
            active={planFilter === p}
            onClick={() => setPlanFilter(p)}
            label={label("company_plan", p)}
            icon={
              p === "ENTERPRISE" ? (
                <Crown className="size-3.5" />
              ) : (
                <Sparkles className="size-3.5" />
              )
            }
          />
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[280px] flex-1">
          <Input
            label={t("owner_companies.search_label")}
            placeholder={t("owner_companies.search_placeholder") ?? ""}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            prefix={<Search className="size-4" />}
          />
        </div>
        <div className="ml-auto">
          <Button
            variant="secondary"
            onClick={() => listQ.refetch()}
            loading={listQ.isFetching}
          >
            <RefreshCw className="size-4" />
            {t("attendance.refresh")}
          </Button>
        </div>
      </div>

      <Table className="min-w-[1100px]">
        <THead>
          <TR>
            <TH className="w-1" />
            <TH>{t("owner_companies.col_company")}</TH>
            <TH>{t("owner_companies.plan")}</TH>
            <TH>{t("owner_companies.subscription_until")}</TH>
            <TH>{t("owner_companies.status")}</TH>
            <TH>{t("owner_companies.created_at")}</TH>
            <TH className="text-right">{t("common.actions")}</TH>
          </TR>
        </THead>
        <TBody>
          {listQ.isLoading ? (
            <TR>
              <TD colSpan={7} className="text-center text-sm text-slate-500">
                {t("common.loading")}
              </TD>
            </TR>
          ) : items.length === 0 ? (
            <TR>
              <TD colSpan={7} className="text-center text-sm text-slate-500">
                {t("common.no_data")}
              </TD>
            </TR>
          ) : (
            items.map((c) => {
              const tone = PLAN_TONE[c.plan];
              return (
                <TR
                  key={c.id}
                  className={cn(
                    "cursor-pointer transition hover:bg-slate-50",
                    !c.is_active && "bg-rose-50/30"
                  )}
                  onClick={() => nav(`/owner/companies/${c.id}/edit`)}
                >
                  <TD className="!w-1 !p-0">
                    <div
                      className={cn(
                        "h-full w-1",
                        !c.is_active
                          ? "bg-rose-400"
                          : c.plan === "ENTERPRISE"
                            ? "bg-amber-500"
                            : c.plan === "PRO"
                              ? "bg-brand-500"
                              : "bg-slate-300"
                      )}
                    />
                  </TD>
                  <TD>
                    <div className="flex items-center gap-2">
                      {c.logo_url ? (
                        <img
                          src={c.logo_url}
                          alt=""
                          className="size-9 rounded-md object-contain ring-1 ring-slate-200"
                        />
                      ) : (
                        <span className="flex size-9 items-center justify-center rounded-md bg-slate-100 text-slate-400">
                          <Building2 className="size-4" />
                        </span>
                      )}
                      <div className="min-w-0">
                        <div className={cn(
                          "text-sm font-semibold",
                          !c.is_active ? "text-slate-500 line-through" : "text-slate-800"
                        )}>
                          {c.name}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          <code className="font-mono">{c.slug}</code>
                          {" · "}
                          {c.country}
                        </div>
                      </div>
                    </div>
                  </TD>
                  <TD>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase ring-1",
                        tone.bg,
                        tone.text,
                        tone.ring
                      )}
                    >
                      {c.plan === "ENTERPRISE" && <Crown className="size-3" />}
                      {label("company_plan", c.plan)}
                    </span>
                  </TD>
                  <TD className="text-xs text-slate-600">
                    {c.subscription_until
                      ? new Date(c.subscription_until).toLocaleDateString(
                          i18n.language
                        )
                      : "—"}
                  </TD>
                  <TD>
                    <Badge tone={c.is_active ? "success" : "danger"}>
                      {c.is_active
                        ? t("owner_companies.status_active")
                        : t("owner_companies.status_suspended")}
                    </Badge>
                  </TD>
                  <TD className="text-xs text-slate-500">
                    {new Date(c.created_at).toLocaleDateString(i18n.language)}
                  </TD>
                  <TD
                    className="text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="inline-flex gap-1">
                      <button
                        type="button"
                        onClick={() => nav(`/owner/companies/${c.id}/edit`)}
                        className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                        title={t("common.edit") ?? undefined}
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      {c.is_active ? (
                        <button
                          type="button"
                          onClick={() => {
                            const reason = window.prompt(
                              t("owner_companies.suspend_reason_prompt") ?? ""
                            );
                            if (reason) suspendMut.mutate({ id: c.id, reason });
                          }}
                          className="rounded-md p-1.5 text-amber-600 hover:bg-amber-50"
                          title={t("owner_companies.suspend") ?? undefined}
                        >
                          <PauseOctagon className="size-3.5" />
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => unsuspendMut.mutate(c.id)}
                            className="rounded-md p-1.5 text-emerald-600 hover:bg-emerald-50"
                            title={
                              t("owner_companies.unsuspend") ?? undefined
                            }
                          >
                            <PlayCircle className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (
                                window.confirm(
                                  t("owner_companies.hard_delete_confirm", {
                                    name: c.name,
                                  }) ?? ""
                                )
                              ) {
                                hardDeleteMut.mutate(c.id);
                              }
                            }}
                            className="rounded-md p-1.5 text-rose-600 hover:bg-rose-50"
                            title={
                              t("owner_companies.hard_delete") ?? undefined
                            }
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </>
                      )}
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

function Chip({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition",
        active
          ? "border-brand-600 bg-brand-600 text-white shadow-sm shadow-brand-600/30"
          : "border-slate-200 bg-white text-slate-700 hover:border-brand-300 hover:bg-brand-50/50"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function Stat({
  tone,
  icon,
  label,
  value,
}: {
  tone: "brand" | "emerald" | "rose" | "amber" | "slate";
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  const cls = {
    brand: "border-brand-200 bg-brand-50 text-brand-800",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
    rose: "border-rose-200 bg-rose-50 text-rose-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    slate: "border-slate-200 bg-white text-slate-700",
  }[tone];
  return (
    <div className={cn("flex items-center gap-2 rounded-lg border px-3 py-2", cls)}>
      <span className="opacity-70">{icon}</span>
      <div>
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
