import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import {
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from "@/components/ui/Table";
import { cn } from "@/lib/cn";
import type {
  Employee,
  KPIDataPoint,
  Page as PageType,
} from "@/lib/types";

import { initialsOf } from "./utils";

export function DatapointsTab() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [showVoid, setShowVoid] = useState(false);
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [metricFilter, setMetricFilter] = useState("");
  const [creating, setCreating] = useState(false);

  const empsQ = useQuery({
    queryKey: ["employees", "for-dp"],
    queryFn: async () =>
      (await api.get<PageType<Employee>>("/employees", { params: { size: 500 } })).data,
  });

  const dpQ = useQuery({
    queryKey: ["kpi", "datapoints", showVoid, employeeFilter, metricFilter],
    queryFn: async () => {
      const params: Record<string, string | boolean> = {
        size: "200",
        include_void: showVoid,
      };
      if (employeeFilter) params.employee_id = employeeFilter;
      if (metricFilter) params.metric_key = metricFilter;
      return (
        await api.get<PageType<KPIDataPoint>>("/kpi/datapoints", { params })
      ).data;
    },
  });

  const voidMut = useMutation({
    mutationFn: async (id: string) => api.delete(`/kpi/datapoints/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kpi", "datapoints"] });
      toast.success(t("kpi_page.datapoint_voided"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const items = dpQ.data?.items ?? [];

  const empById = new Map((empsQ.data?.items ?? []).map((e) => [e.id, e]));

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-brand-200 bg-brand-50/50 px-3 py-2 text-xs text-brand-800">
        {t("kpi_page.datapoints_subtitle")}
      </div>

      <div className="flex flex-wrap items-end gap-2">
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
        <Input
          label={t("kpi_page.datapoint_metric_key")}
          value={metricFilter}
          onChange={(e) => setMetricFilter(e.target.value)}
          placeholder="sold_amount"
        />
        <label className="flex items-center gap-2 text-xs text-slate-700">
          <input
            type="checkbox"
            checked={showVoid}
            onChange={(e) => setShowVoid(e.target.checked)}
          />
          {t("kpi_page.datapoint_show_void")}
        </label>
        <div className="ml-auto">
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            {t("kpi_page.datapoints")}
          </Button>
        </div>
      </div>

      <Table className="min-w-[900px]">
        <THead>
          <TR>
            <TH>{t("kpi_page.datapoint_recorded_at")}</TH>
            <TH>{t("kpi_page.employee")}</TH>
            <TH>{t("kpi_page.datapoint_metric_key")}</TH>
            <TH className="text-right">{t("kpi_page.datapoint_value")}</TH>
            <TH>{t("kpi_page.datapoint_source")}</TH>
            <TH>{t("kpi_page.datapoint_note")}</TH>
            <TH className="w-[60px]">·</TH>
          </TR>
        </THead>
        <TBody>
          {dpQ.isLoading ? (
            <TR>
              <TD colSpan={7} className="text-center text-sm text-slate-500">…</TD>
            </TR>
          ) : items.length === 0 ? (
            <TR>
              <TD colSpan={7} className="text-center text-sm text-slate-500">
                {t("kpi_page.no_datapoints")}
              </TD>
            </TR>
          ) : (
            items.map((d) => {
              const emp = empById.get(d.employee_id);
              return (
                <TR
                  key={d.id}
                  className={cn(d.is_void && "opacity-50")}
                >
                  <TD className="tabular-nums text-xs text-slate-600">
                    {new Date(d.recorded_at).toLocaleString(i18n.language, {
                      year: "numeric",
                      month: "short",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </TD>
                  <TD>
                    <div className="flex items-center gap-2">
                      {emp?.photo_url ? (
                        <img
                          src={emp.photo_url}
                          alt=""
                          className="size-7 rounded-full object-cover ring-1 ring-slate-200"
                        />
                      ) : (
                        <span className="flex size-7 items-center justify-center rounded-full bg-brand-50 text-[9px] font-semibold text-brand-700">
                          {initialsOf(emp?.full_name)}
                        </span>
                      )}
                      <span className="text-sm text-slate-700">
                        {emp?.full_name ?? d.employee_id.slice(0, 8)}
                      </span>
                    </div>
                  </TD>
                  <TD>
                    <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-700">
                      {d.metric_key}
                    </span>
                  </TD>
                  <TD className="text-right tabular-nums text-sm font-semibold text-slate-800">
                    {Number(d.value).toLocaleString("ru-RU").replace(/,/g, " ")}
                  </TD>
                  <TD className="text-xs text-slate-600">{d.source ?? "—"}</TD>
                  <TD className="text-xs text-slate-500">{d.note ?? ""}</TD>
                  <TD>
                    {!d.is_void && (
                      <button
                        type="button"
                        onClick={() => voidMut.mutate(d.id)}
                        className="rounded-md p-1.5 text-rose-500 hover:bg-rose-50"
                        title={t("kpi_page.datapoint_void") ?? undefined}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </TD>
                </TR>
              );
            })
          )}
        </TBody>
      </Table>

      {creating && (
        <DatapointCreateDialog
          employees={empsQ.data?.items ?? []}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}

function DatapointCreateDialog({
  employees,
  onClose,
}: {
  employees: Employee[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [employeeId, setEmployeeId] = useState("");
  const [metricKey, setMetricKey] = useState("");
  const [value, setValue] = useState("");
  const [recordedAt, setRecordedAt] = useState(
    new Date().toISOString().slice(0, 16)
  );
  const [source, setSource] = useState("manual");
  const [note, setNote] = useState("");

  const mut = useMutation({
    mutationFn: async () =>
      (
        await api.post<KPIDataPoint>("/kpi/datapoints", {
          employee_id: employeeId,
          metric_key: metricKey,
          value,
          recorded_at: new Date(recordedAt).toISOString(),
          source: source || null,
          note: note || null,
        })
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kpi", "datapoints"] });
      toast.success(t("kpi_page.save"));
      onClose();
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  return (
    <Dialog open onClose={onClose} title={t("kpi_page.datapoints")}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!employeeId || !metricKey || !value) {
            toast.error(t("common.required") ?? "");
            return;
          }
          mut.mutate();
        }}
      >
        <div>
          <label className="label">{t("kpi_page.employee")}</label>
          <select
            className="input"
            required
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
          >
            <option value="">—</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.full_name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input
            label={t("kpi_page.datapoint_metric_key")}
            placeholder={t("kpi_page.datapoint_metric_key_placeholder") ?? ""}
            required
            value={metricKey}
            onChange={(e) => setMetricKey(e.target.value)}
          />
          <Input
            label={t("kpi_page.datapoint_value")}
            type="number"
            step="0.0001"
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        <Input
          type="datetime-local"
          label={t("kpi_page.datapoint_recorded_at")}
          value={recordedAt}
          onChange={(e) => setRecordedAt(e.target.value)}
        />
        <Input
          label={t("kpi_page.datapoint_source")}
          value={source}
          onChange={(e) => setSource(e.target.value)}
        />
        <div>
          <label className="label">{t("kpi_page.datapoint_note")}</label>
          <textarea
            className="input"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" loading={mut.isPending}>
            {t("kpi_page.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
