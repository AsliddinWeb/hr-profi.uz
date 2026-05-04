import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  Clock,
  Eye,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from "@/components/ui/Table";
import { useEnumLabel } from "@/lib/enum";
import { cn } from "@/lib/cn";
import type {
  Branch,
  Employee,
  KPIAssignmentDetail,
  KPIAssignmentStatus,
  KPICategory,
  KPIRecomputeResult,
  KPITemplate,
  Page as PageType,
} from "@/lib/types";

import { AssignmentCreateDialog } from "./AssignmentCreateDialog";
import { AssignmentDetailDrawer } from "./AssignmentDetailDrawer";
import {
  CATEGORY_COLOR,
  STATUS_TONE,
  fmtMoney,
  fmtScore,
  initialsOf,
  scoreTone,
} from "./utils";

const STATUS_OPTS: KPIAssignmentStatus[] = [
  "DRAFT",
  "ACTIVE",
  "COMPUTED",
  "APPROVED",
  "PAID",
  "REJECTED",
  "CANCELLED",
];

const CATEGORIES: KPICategory[] = [
  "ATTENDANCE",
  "SALES",
  "TASKS",
  "QUALITY",
  "MANAGER_REVIEW",
  "GOAL",
  "CUSTOM",
];

export function AssignmentsTab() {
  const { t } = useTranslation();
  const label = useEnumLabel();
  const qc = useQueryClient();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [statusFilter, setStatusFilter] = useState<"" | KPIAssignmentStatus>(
    ""
  );
  const [categoryFilter, setCategoryFilter] = useState<"" | KPICategory>("");
  const [branchFilter, setBranchFilter] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const branchesQ = useQuery({
    queryKey: ["branches", "for-kpi"],
    queryFn: async () =>
      (await api.get<PageType<Branch>>("/branches", { params: { size: 200 } })).data,
  });
  const empsQ = useQuery({
    queryKey: ["employees", "for-kpi"],
    queryFn: async () =>
      (await api.get<PageType<Employee>>("/employees", { params: { size: 500 } })).data,
  });
  const tplQ = useQuery({
    queryKey: ["kpi", "templates", "active"],
    queryFn: async () =>
      (await api.get<KPITemplate[]>("/kpi/templates", { params: { active_only: true } })).data,
  });

  const listQ = useQuery({
    queryKey: [
      "kpi",
      "assignments",
      year,
      month,
      statusFilter,
      categoryFilter,
      branchFilter,
      employeeFilter,
    ],
    queryFn: async () => {
      const params: Record<string, string | number> = {
        year,
        month,
        size: 200,
      };
      if (statusFilter) params.status = statusFilter;
      if (categoryFilter) params.category = categoryFilter;
      if (branchFilter) params.branch_id = branchFilter;
      if (employeeFilter) params.employee_id = employeeFilter;
      return (
        await api.get<PageType<KPIAssignmentDetail>>("/kpi/assignments", { params })
      ).data;
    },
  });

  const recomputeAllMut = useMutation({
    mutationFn: async () =>
      (
        await api.post<KPIRecomputeResult>("/kpi/bulk/recompute", {
          year,
          month,
        })
      ).data,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["kpi"] });
      toast.success(`${res.recomputed} ✓ / ${res.failed} ✗`);
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const items = listQ.data?.items ?? [];
  const empMap = useMemo(
    () => new Map((empsQ.data?.items ?? []).map((e) => [e.id, e])),
    [empsQ.data]
  );

  return (
    <div className="space-y-4">
      {/* Stats strip */}
      <Stats items={items} />

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-2">
        <Input
          type="number"
          label={t("kpi_page.year")}
          value={year}
          onChange={(e) => setYear(Number(e.target.value) || today.getFullYear())}
          className="w-24"
        />
        <Input
          type="number"
          label={t("kpi_page.month")}
          min={1}
          max={12}
          value={month}
          onChange={(e) => setMonth(Number(e.target.value) || today.getMonth() + 1)}
          className="w-24"
        />
        <div>
          <label className="label">{t("kpi_page.status")}</label>
          <select
            className="input min-w-[140px]"
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as KPIAssignmentStatus | "")
            }
          >
            <option value="">—</option>
            {STATUS_OPTS.map((s) => (
              <option key={s} value={s}>
                {label("kpi_assignment_status", s)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{t("kpi_page.category")}</label>
          <select
            className="input min-w-[140px]"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as KPICategory | "")}
          >
            <option value="">—</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {label("kpi_category", c)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{t("kpi_page.bulk_target_filiallar")}</label>
          <select
            className="input min-w-[160px]"
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
          >
            <option value="">—</option>
            {(branchesQ.data?.items ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{t("kpi_page.employee")}</label>
          <select
            className="input min-w-[180px]"
            value={employeeFilter}
            onChange={(e) => setEmployeeFilter(e.target.value)}
          >
            <option value="">—</option>
            {(empsQ.data?.items ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.full_name}
              </option>
            ))}
          </select>
        </div>
        <div className="ml-auto flex gap-2">
          <Button
            variant="secondary"
            onClick={() => recomputeAllMut.mutate()}
            loading={recomputeAllMut.isPending}
          >
            <RefreshCw className="size-4" />
            {t("kpi_page.recompute_all")}
          </Button>
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            {t("kpi_page.assign")}
          </Button>
        </div>
      </div>

      {/* Table */}
      <Table className="min-w-[1200px]">
        <THead>
          <TR>
            <TH className="w-1" />
            <TH>{t("kpi_page.employee")}</TH>
            <TH>{t("kpi_page.template")}</TH>
            <TH className="text-right">{t("kpi_page.target")}</TH>
            <TH className="text-right">{t("kpi_page.actual")}</TH>
            <TH className="text-right">{t("kpi_page.score")}</TH>
            <TH className="text-right">{t("kpi_page.reward")}</TH>
            <TH>{t("kpi_page.status")}</TH>
            <TH className="w-[80px]">·</TH>
          </TR>
        </THead>
        <TBody>
          {listQ.isLoading ? (
            <TR>
              <TD colSpan={9} className="text-center text-sm text-slate-500">
                …
              </TD>
            </TR>
          ) : items.length === 0 ? (
            <TR>
              <TD colSpan={9} className="text-center text-sm text-slate-500">
                {t("kpi_page.no_assignments")}
              </TD>
            </TR>
          ) : (
            items.map((a) => {
              const emp = empMap.get(a.employee_id);
              const tone = STATUS_TONE[a.status];
              const sTone = scoreTone(a.score);
              return (
                <TR
                  key={a.id}
                  className="cursor-pointer transition hover:bg-slate-50"
                  onClick={() => setActiveId(a.id)}
                >
                  <TD className="!w-1 !p-0">
                    <div className={cn("h-full w-1", tone.bar)} />
                  </TD>
                  <TD>
                    <div className="flex items-center gap-2">
                      {emp?.photo_url ? (
                        <img
                          src={emp.photo_url}
                          alt=""
                          className="size-8 rounded-full object-cover ring-1 ring-slate-200"
                        />
                      ) : (
                        <span className="flex size-8 items-center justify-center rounded-full bg-brand-50 text-[10px] font-semibold text-brand-700">
                          {initialsOf(a.employee_name)}
                        </span>
                      )}
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-800">
                          {a.employee_name}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {a.employee_code}
                        </div>
                      </div>
                    </div>
                  </TD>
                  <TD>
                    <div className="text-sm text-slate-700">
                      {a.template_name}
                    </div>
                    {a.template_category && (
                      <span
                        className={cn(
                          "mt-0.5 inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ring-1",
                          CATEGORY_COLOR[a.template_category]
                        )}
                      >
                        {label("kpi_category", a.template_category)}
                      </span>
                    )}
                  </TD>
                  <TD className="text-right tabular-nums text-xs text-slate-700">
                    {a.target}
                    {a.template_unit ? ` ${a.template_unit}` : ""}
                  </TD>
                  <TD className="text-right tabular-nums text-xs text-slate-700">
                    {a.actual}
                  </TD>
                  <TD className="text-right">
                    <span
                      className={cn(
                        "inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-bold ring-1 tabular-nums",
                        sTone.bg,
                        sTone.text,
                        sTone.ring
                      )}
                    >
                      {fmtScore(a.score)}%
                    </span>
                  </TD>
                  <TD className="text-right">
                    {Number(a.computed_reward) > 0 ? (
                      <span
                        className={cn(
                          "tabular-nums text-sm font-semibold",
                          a.is_penalty ? "text-rose-700" : "text-emerald-700"
                        )}
                      >
                        {a.is_penalty ? "−" : "+"}
                        {fmtMoney(a.computed_reward)}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                    {a.last_compute_error && (
                      <span
                        title={a.last_compute_error}
                        className="ml-1 inline-block"
                      >
                        <AlertTriangle className="inline size-3 text-rose-500" />
                      </span>
                    )}
                  </TD>
                  <TD>
                    <Badge tone={tone.badge}>
                      {label("kpi_assignment_status", a.status)}
                    </Badge>
                  </TD>
                  <TD>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveId(a.id);
                      }}
                      className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                    >
                      <Eye className="size-3.5" />
                    </button>
                  </TD>
                </TR>
              );
            })
          )}
        </TBody>
      </Table>

      {creating && (
        <AssignmentCreateDialog
          templates={tplQ.data ?? []}
          employees={empsQ.data?.items ?? []}
          year={year}
          month={month}
          onClose={() => setCreating(false)}
        />
      )}
      {activeId && (
        <AssignmentDetailDrawer
          assignmentId={activeId}
          onClose={() => setActiveId(null)}
        />
      )}
    </div>
  );
}

function Stats({ items }: { items: KPIAssignmentDetail[] }) {
  const { t } = useTranslation();
  const stats = useMemo(() => {
    let avg = 0;
    let reward = 0;
    let penalty = 0;
    let pendingApproval = 0;
    for (const a of items) {
      avg += Number(a.score) || 0;
      if (a.is_penalty) penalty += Number(a.computed_reward) || 0;
      else reward += Number(a.computed_reward) || 0;
      if (a.status === "COMPUTED") pendingApproval += 1;
    }
    return {
      total: items.length,
      avg: items.length ? avg / items.length : 0,
      reward,
      penalty,
      pendingApproval,
    };
  }, [items]);
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      <Tile
        tone="brand"
        icon={<Eye className="size-4" />}
        label={t("kpi_page.stat_assignments")}
        value={stats.total.toLocaleString()}
      />
      <Tile
        tone="indigo"
        icon={<Clock className="size-4" />}
        label={t("kpi_page.stat_avg_score")}
        value={`${stats.avg.toFixed(1)}%`}
      />
      <Tile
        tone="emerald"
        icon={<Check className="size-4" />}
        label={t("kpi_page.stat_total_reward")}
        value={fmtMoney(stats.reward)}
      />
      <Tile
        tone="rose"
        icon={<X className="size-4" />}
        label={t("kpi_page.stat_total_penalty")}
        value={fmtMoney(stats.penalty)}
      />
      <Tile
        tone="amber"
        icon={<AlertTriangle className="size-4" />}
        label={t("kpi_assignment_status.COMPUTED")}
        value={stats.pendingApproval.toLocaleString()}
      />
    </div>
  );
}

function Tile({
  tone,
  icon,
  label,
  value,
}: {
  tone: "brand" | "emerald" | "amber" | "rose" | "indigo";
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  const cls = {
    brand: "border-brand-200 bg-brand-50 text-brand-800",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    rose: "border-rose-200 bg-rose-50 text-rose-800",
    indigo: "border-indigo-200 bg-indigo-50 text-indigo-800",
  }[tone];
  return (
    <div className={cn("flex items-center gap-2 rounded-lg border px-3 py-2", cls)}>
      <span className="opacity-70">{icon}</span>
      <div className="min-w-0">
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
