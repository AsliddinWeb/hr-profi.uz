import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Dialog, DialogFooter } from "@/components/ui/Dialog";
import { useEnumLabel } from "@/lib/enum";
import type { AttendanceRecord, CheckType, Employee, Page } from "@/lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
}

interface FormState {
  employee_id: string;
  check_type: CheckType;
  timestamp: string;
  notes: string;
}

const empty: FormState = {
  employee_id: "",
  check_type: "CHECK_IN",
  timestamp: new Date().toISOString().slice(0, 16),
  notes: "",
};

export function ManualEntryDialog({ open, onClose }: Props) {
  const { t } = useTranslation();
  const label = useEnumLabel();
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(empty);

  const empQ = useQuery({
    queryKey: ["employees", "for-manual-entry"],
    queryFn: async () =>
      (await api.get<Page<Employee>>("/employees", { params: { size: 200, is_active: true } })).data,
    enabled: open,
  });

  const mut = useMutation({
    mutationFn: async () =>
      (
        await api.post<AttendanceRecord>("/attendance/manual", {
          employee_id: form.employee_id,
          check_type: form.check_type,
          timestamp: new Date(form.timestamp).toISOString(),
          notes: form.notes || undefined,
        })
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["attendance"] });
      setForm(empty);
      onClose();
    },
  });

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <Dialog open={open} onClose={onClose} title={t("attendance.manual_create")}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          mut.mutate();
        }}
      >
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>{t("attendance.manual_warning")}</p>
        </div>

        <div>
          <label className="label">{t("attendance.employee")}</label>
          <select
            className="input"
            value={form.employee_id}
            onChange={(e) => set("employee_id", e.target.value)}
            required
          >
            <option value="">— {t("common.select")} —</option>
            {empQ.data?.items.map((e) => (
              <option key={e.id} value={e.id}>
                {e.full_name} ({e.employee_code})
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">{t("attendance.type")}</label>
            <select
              className="input"
              value={form.check_type}
              onChange={(e) => set("check_type", e.target.value as CheckType)}
            >
              <option value="CHECK_IN">{label("check_type", "CHECK_IN")}</option>
              <option value="CHECK_OUT">{label("check_type", "CHECK_OUT")}</option>
            </select>
          </div>
          <Input
            label={t("attendance.when")}
            type="datetime-local"
            value={form.timestamp}
            onChange={(e) => set("timestamp", e.target.value)}
            required
          />
        </div>

        <Input
          label={t("attendance.notes")}
          value={form.notes}
          onChange={(e) => set("notes", e.target.value)}
          placeholder={t("attendance.manual_notes_placeholder") ?? ""}
          maxLength={500}
        />

        {mut.isError && (
          <p className="text-sm text-red-600">{apiErrorMessage(mut.error)}</p>
        )}
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" loading={mut.isPending}>
            {t("common.create")}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
