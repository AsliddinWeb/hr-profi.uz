import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { api, apiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import type { Employee, KPIAssignment, KPITemplate } from "@/lib/types";

export function AssignmentCreateDialog({
  templates,
  employees,
  year,
  month,
  onClose,
}: {
  templates: KPITemplate[];
  employees: Employee[];
  year: number;
  month: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [employeeId, setEmployeeId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [target, setTarget] = useState("");
  const [notes, setNotes] = useState("");

  const tpl = templates.find((tt) => tt.id === templateId);

  const saveMut = useMutation({
    mutationFn: async () =>
      (
        await api.post<KPIAssignment>("/kpi/assignments", {
          employee_id: employeeId,
          kpi_template_id: templateId,
          year,
          month,
          target: target || tpl?.target_value || "0",
          notes: notes || null,
        })
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kpi"] });
      toast.success(t("kpi_page.save"));
      onClose();
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  return (
    <Dialog open onClose={onClose} title={t("kpi_page.assign")}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!employeeId || !templateId) {
            toast.error(t("common.required") ?? "");
            return;
          }
          saveMut.mutate();
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
        <div>
          <label className="label">{t("kpi_page.template")}</label>
          <select
            className="input"
            required
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
          >
            <option value="">—</option>
            {templates.map((tt) => (
              <option key={tt.id} value={tt.id}>
                {tt.name}
              </option>
            ))}
          </select>
          {tpl && (
            <p className="mt-1 text-[11px] text-slate-500">
              {tpl.description}
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input
            type="number"
            label={t("kpi_page.year")}
            value={year}
            disabled
          />
          <Input
            type="number"
            label={t("kpi_page.month")}
            value={month}
            disabled
          />
        </div>
        <Input
          type="number"
          step="0.01"
          label={t("kpi_page.target")}
          placeholder={tpl?.target_value ?? ""}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        />
        <div>
          <label className="label">{t("kpi_page.notes")}</label>
          <textarea
            className="input"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" loading={saveMut.isPending}>
            {t("kpi_page.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
