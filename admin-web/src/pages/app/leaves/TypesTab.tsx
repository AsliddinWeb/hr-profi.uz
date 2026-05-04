import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  CalendarDays,
  Coins,
  FileWarning,
  Pencil,
  Plus,
  Trash2,
  Users,
} from "lucide-react";

import { api } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import type { LeaveRequest, LeaveType } from "@/lib/types";

export function TypesTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const nav = useNavigate();

  const typesQ = useQuery({
    queryKey: ["leave-types"],
    queryFn: async () => (await api.get<LeaveType[]>("/leave-types")).data,
  });

  // Pull all leaves so we can show per-type usage on the cards. Cheap (whole
  // company is typically a few hundred rows) and the cache is shared with
  // other leave tabs.
  const requestsQ = useQuery({
    queryKey: ["leave-requests"],
    queryFn: async () => (await api.get<LeaveRequest[]>("/leave-requests")).data,
  });

  /** Aggregate per leave_type_id → usage counts, scoped to the current
   * calendar year so the numbers reset every January like a balance does. */
  const usageByType = useMemo(() => {
    const out = new Map<
      string,
      { active: number; days: number; employees: Set<string>; pending: number }
    >();
    const year = new Date().getFullYear();
    for (const r of requestsQ.data ?? []) {
      // Skip rejected / cancelled — they're audit-only at this point.
      if (r.status !== "APPROVED" && r.status !== "PENDING") continue;
      // Drop leaves that don't touch this year at all.
      if (
        Number(r.start_date.slice(0, 4)) > year ||
        Number(r.end_date.slice(0, 4)) < year
      )
        continue;
      let row = out.get(r.leave_type_id);
      if (!row) {
        row = { active: 0, days: 0, employees: new Set(), pending: 0 };
        out.set(r.leave_type_id, row);
      }
      if (r.status === "APPROVED") {
        row.active += 1;
        row.days += r.days;
      }
      if (r.status === "PENDING") row.pending += 1;
      row.employees.add(r.employee_id);
    }
    return out;
  }, [requestsQ.data]);

  const deleteMut = useMutation({
    mutationFn: async (id: string) => api.delete(`/leave-types/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leave-types"] }),
  });

  const items = typesQ.data ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-xl text-xs text-slate-500">
          {t("leaves.types_subtitle")}
        </p>
        <Button onClick={() => nav("/app/leaves/types/new")}>
          <Plus className="size-4" />
          {t("leaves.add_type")}
        </Button>
      </div>

      {typesQ.isLoading ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          {t("common.loading")}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white px-6 py-12">
          <div className="mx-auto flex max-w-sm flex-col items-center gap-2 text-center">
            <CalendarDays className="size-8 text-slate-300" />
            <p className="text-sm font-medium text-slate-700">
              {t("leaves.types_empty_title")}
            </p>
            <p className="text-xs text-slate-500">{t("leaves.types_empty_hint")}</p>
            <Button type="button" onClick={() => nav("/app/leaves/types/new")} className="mt-2">
              <Plus className="size-4" />
              {t("leaves.add_type")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((tp) => (
            <div
              key={tp.id}
              className={cn(
                "group relative rounded-lg border border-slate-200 bg-white p-4 transition hover:shadow-md",
                !tp.is_active && "opacity-60"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-semibold text-slate-800">
                    {tp.name}
                  </h3>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge tone={tp.paid ? "success" : "default"}>
                      <Coins className="mr-0.5 inline size-3" />
                      {tp.paid ? t("leaves.paid") : t("leaves.unpaid")}
                    </Badge>
                    {tp.requires_document && (
                      <Badge tone="warning">
                        <FileWarning className="mr-0.5 inline size-3" />
                        {t("leaves.requires_document_short")}
                      </Badge>
                    )}
                    {!tp.is_active && (
                      <Badge tone="danger">{t("common.inactive")}</Badge>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => nav(`/app/leaves/types/${tp.id}/edit`)}
                    className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-brand-600"
                  >
                    <Pencil className="size-4" />
                  </button>
                  {tp.is_active && (
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(t("leaves.delete_type_confirm", { name: tp.name }) || "Delete?")) {
                          deleteMut.mutate(tp.id);
                        }
                      }}
                      className="rounded-md p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat
                  icon={<CalendarDays className="size-3" />}
                  label={t("leaves.max_days_per_year")}
                  value={tp.max_days_per_year != null ? `${tp.max_days_per_year}d` : "∞"}
                />
                <Stat
                  icon={<Coins className="size-3" />}
                  label={t("leaves.salary_impact")}
                  value={
                    tp.paid
                      ? t("leaves.salary_impact_paid_short")
                      : t("leaves.salary_impact_unpaid_short")
                  }
                  tone={tp.paid ? "emerald" : "slate"}
                />
                <Stat
                  icon={<Users className="size-3" />}
                  label={t("leaves.usage_employees")}
                  value={String(usageByType.get(tp.id)?.employees.size ?? 0)}
                />
                <Stat
                  icon={<CalendarDays className="size-3" />}
                  label={t("leaves.usage_days")}
                  value={String(usageByType.get(tp.id)?.days ?? 0)}
                  tone={(usageByType.get(tp.id)?.days ?? 0) > 0 ? "brand" : "slate"}
                />
              </div>

              {/* Pending callout (pendings need attention) */}
              {(usageByType.get(tp.id)?.pending ?? 0) > 0 && (
                <div className="mt-2 inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-800 ring-1 ring-amber-200">
                  <Coins className="size-3" />
                  {t("leaves.usage_pending", {
                    count: usageByType.get(tp.id)!.pending,
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

    </div>
  );
}

function Stat({
  label,
  value,
  tone = "slate",
  icon,
}: {
  label: string;
  value: string;
  tone?: "slate" | "emerald" | "brand";
  icon?: React.ReactNode;
}) {
  const cls =
    tone === "emerald"
      ? "bg-emerald-50 ring-emerald-200 text-emerald-700"
      : tone === "brand"
      ? "bg-brand-50 ring-brand-200 text-brand-700"
      : "bg-slate-50 ring-slate-200 text-slate-700";
  return (
    <div className={cn("rounded-md px-2.5 py-1.5 ring-1", cls)}>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide opacity-70">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}
