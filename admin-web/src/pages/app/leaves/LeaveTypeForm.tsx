import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import type { LeaveType } from "@/lib/types";

export interface LeaveTypeFormValue {
  name: string;
  paid: boolean;
  max_days_per_year: string;
  requires_document: boolean;
}

export const emptyLeaveTypeForm: LeaveTypeFormValue = {
  name: "",
  paid: true,
  max_days_per_year: "",
  requires_document: false,
};

export function leaveTypeToForm(t: LeaveType): LeaveTypeFormValue {
  return {
    name: t.name,
    paid: t.paid,
    max_days_per_year: t.max_days_per_year != null ? String(t.max_days_per_year) : "",
    requires_document: t.requires_document,
  };
}

export function leaveTypeFormToBody(f: LeaveTypeFormValue) {
  return {
    name: f.name.trim(),
    paid: f.paid,
    max_days_per_year: f.max_days_per_year ? Number(f.max_days_per_year) : null,
    requires_document: f.requires_document,
  };
}

interface Props {
  value: LeaveTypeFormValue;
  onChange: (next: LeaveTypeFormValue) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitting: boolean;
  submitLabel: string;
  errorMessage?: string | null;
}

export function LeaveTypeForm({
  value,
  onChange,
  onSubmit,
  onCancel,
  submitting,
  submitLabel,
  errorMessage,
}: Props) {
  const { t } = useTranslation();
  const set = <K extends keyof LeaveTypeFormValue>(k: K, v: LeaveTypeFormValue[K]) =>
    onChange({ ...value, [k]: v });

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <Card>
        <div className="space-y-5 p-6">
          <div>
            <h2 className="text-sm font-semibold text-slate-700">
              {t("leaves.type_section_basics")}
            </h2>
            <p className="text-xs text-slate-500">
              {t("leaves.type_section_basics_hint")}
            </p>
          </div>
          <Input
            label={t("leaves.type_name")}
            value={value.name}
            onChange={(e) => set("name", e.target.value)}
            required
            maxLength={100}
            placeholder={t("leaves.type_name_placeholder") ?? ""}
          />
          <Input
            label={t("leaves.max_days_per_year")}
            type="number"
            min="0"
            max="365"
            value={value.max_days_per_year}
            onChange={(e) => set("max_days_per_year", e.target.value)}
            placeholder="21"
            hint={t("leaves.max_days_hint") ?? undefined}
          />
        </div>
      </Card>

      <Card>
        <div className="space-y-3 p-6">
          <div>
            <h2 className="text-sm font-semibold text-slate-700">
              {t("leaves.type_section_rules")}
            </h2>
            <p className="text-xs text-slate-500">
              {t("leaves.type_section_rules_hint")}
            </p>
          </div>
          <label className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 hover:border-slate-300">
            <input
              type="checkbox"
              className="mt-0.5 size-4 rounded border-slate-300 text-emerald-600"
              checked={value.paid}
              onChange={(e) => set("paid", e.target.checked)}
            />
            <div>
              <div className="text-sm font-medium">{t("leaves.paid")}</div>
              <div className="text-xs text-slate-500">{t("leaves.paid_hint")}</div>
            </div>
          </label>
          <label className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 hover:border-slate-300">
            <input
              type="checkbox"
              className="mt-0.5 size-4 rounded border-slate-300 text-amber-600"
              checked={value.requires_document}
              onChange={(e) => set("requires_document", e.target.checked)}
            />
            <div>
              <div className="text-sm font-medium">{t("leaves.requires_document")}</div>
              <div className="text-xs text-slate-500">
                {t("leaves.requires_document_hint")}
              </div>
            </div>
          </label>
        </div>
      </Card>

      {errorMessage && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorMessage}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" loading={submitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
