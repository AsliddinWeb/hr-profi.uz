import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Building2, Check, Layers, Play, Users } from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/cn";
import type {
  Branch,
  Department,
  Employee,
  KPIBulkAssignResult,
  KPITemplate,
  Page,
} from "@/lib/types";

type Mode = "branches" | "departments" | "employees";

export function BulkAssignTab() {
  const { t } = useTranslation();
  const today = new Date();

  const [templateId, setTemplateId] = useState("");
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [target, setTarget] = useState("");
  const [mode, setMode] = useState<Mode>("branches");
  const [picked, setPicked] = useState<string[]>([]);
  const [skipExisting, setSkipExisting] = useState(true);

  const tplQ = useQuery({
    queryKey: ["kpi", "templates", "active"],
    queryFn: async () =>
      (await api.get<KPITemplate[]>("/kpi/templates", { params: { active_only: true } })).data,
  });
  const branchesQ = useQuery({
    queryKey: ["branches", "for-bulk"],
    queryFn: async () =>
      (await api.get<Page<Branch>>("/branches", { params: { size: 200 } })).data,
  });
  const deptsQ = useQuery({
    queryKey: ["departments", "for-bulk"],
    queryFn: async () =>
      (await api.get<Page<Department>>("/departments", { params: { size: 200 } })).data,
  });
  const empsQ = useQuery({
    queryKey: ["employees", "for-bulk"],
    queryFn: async () =>
      (await api.get<Page<Employee>>("/employees", { params: { size: 500 } })).data,
  });

  const tpl = tplQ.data?.find((t) => t.id === templateId);

  const bulkMut = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        kpi_template_id: templateId,
        year,
        month,
        target: target || tpl?.target_value || "0",
        skip_existing: skipExisting,
      };
      if (mode === "branches") payload.branch_ids = picked;
      if (mode === "departments") payload.department_ids = picked;
      if (mode === "employees") payload.employee_ids = picked;
      return (
        await api.post<KPIBulkAssignResult>("/kpi/bulk/assign", payload)
      ).data;
    },
    onSuccess: (res) => {
      toast.success(
        t("kpi_page.bulk_result", {
          created: res.created,
          skipped: res.skipped,
          failed: res.failed,
        })
      );
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const togglePick = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const optionRows = useMemo(() => {
    if (mode === "branches")
      return (branchesQ.data?.items ?? []).map((b) => ({
        id: b.id,
        name: b.name,
        sub: null,
      }));
    if (mode === "departments")
      return (deptsQ.data?.items ?? []).map((d) => ({
        id: d.id,
        name: d.name,
        sub: d.code ?? null,
      }));
    return (empsQ.data?.items ?? []).map((e) => ({
      id: e.id,
      name: e.full_name,
      sub: e.position ?? e.employee_code,
    }));
  }, [mode, branchesQ.data, deptsQ.data, empsQ.data]);

  const filteredCount = picked.length;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-brand-200 bg-brand-50/50 px-3 py-2 text-xs text-brand-800">
        {t("kpi_page.bulk_assign_subtitle")}
      </div>

      {/* Step 1: pick template + period */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          1 · {t("kpi_page.template")}
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <label className="label">{t("kpi_page.template")}</label>
            <select
              className="input"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
            >
              <option value="">—</option>
              {(tplQ.data ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <Input
            type="number"
            label={t("kpi_page.year")}
            value={year}
            onChange={(e) => setYear(Number(e.target.value) || today.getFullYear())}
          />
          <Input
            type="number"
            min={1}
            max={12}
            label={t("kpi_page.month")}
            value={month}
            onChange={(e) => setMonth(Number(e.target.value) || today.getMonth() + 1)}
          />
          <Input
            type="number"
            step="0.01"
            label={t("kpi_page.target")}
            placeholder={tpl?.target_value ?? ""}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
        </div>
      </div>

      {/* Step 2: pick scope */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          2 · {t("kpi_page.assignments")}
        </h3>
        <div className="flex flex-wrap gap-2">
          <ScopeBtn
            active={mode === "branches"}
            onClick={() => {
              setMode("branches");
              setPicked([]);
            }}
            icon={<Building2 className="size-3.5" />}
            label={t("kpi_page.bulk_target_filiallar")}
          />
          <ScopeBtn
            active={mode === "departments"}
            onClick={() => {
              setMode("departments");
              setPicked([]);
            }}
            icon={<Layers className="size-3.5" />}
            label={t("kpi_page.bulk_target_bolimlar")}
          />
          <ScopeBtn
            active={mode === "employees"}
            onClick={() => {
              setMode("employees");
              setPicked([]);
            }}
            icon={<Users className="size-3.5" />}
            label={t("kpi_page.bulk_target_xodimlar")}
          />
        </div>

        <div className="max-h-[420px] overflow-y-auto rounded-md border border-slate-200">
          <ul className="divide-y divide-slate-200">
            {optionRows.map((r) => {
              const on = picked.includes(r.id);
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => togglePick(r.id)}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition",
                      on ? "bg-brand-50" : "hover:bg-slate-50"
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-4 items-center justify-center rounded border",
                        on
                          ? "border-brand-600 bg-brand-600 text-white"
                          : "border-slate-300 bg-white"
                      )}
                    >
                      {on && <Check className="size-3" />}
                    </span>
                    <span className="flex-1">
                      <span className="font-medium text-slate-800">
                        {r.name}
                      </span>
                      {r.sub && (
                        <span className="ml-2 text-[11px] text-slate-500">
                          {r.sub}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <label className="flex items-center gap-2 text-xs text-slate-700">
          <input
            type="checkbox"
            checked={skipExisting}
            onChange={(e) => setSkipExisting(e.target.checked)}
          />
          {t("kpi_page.bulk_skip_existing")}
        </label>
      </div>

      {/* Run */}
      <div className="flex justify-end gap-2">
        <Button
          disabled={!templateId || picked.length === 0}
          loading={bulkMut.isPending}
          onClick={() => bulkMut.mutate()}
        >
          <Play className="size-4" />
          {t("kpi_page.bulk_run")} ({filteredCount})
        </Button>
      </div>

      {bulkMut.data && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          ✓{" "}
          {t("kpi_page.bulk_result", {
            created: bulkMut.data.created,
            skipped: bulkMut.data.skipped,
            failed: bulkMut.data.failed,
          })}
          {bulkMut.data.failures.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer">×{bulkMut.data.failed}</summary>
              <ul className="mt-1 space-y-0.5 pl-3 text-[10px] text-rose-700">
                {bulkMut.data.failures.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function ScopeBtn({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition",
        active
          ? "border-brand-600 bg-brand-600 text-white shadow-sm"
          : "border-slate-200 bg-white text-slate-700 hover:border-brand-300"
      )}
    >
      {icon}
      {label}
    </button>
  );
}
