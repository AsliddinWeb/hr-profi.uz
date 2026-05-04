import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Banknote,
  CalendarDays,
  Coins,
  Info,
  Sigma,
} from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/PageHeader";
import type { Employee, LeaveAdjustment, LeaveType, Page } from "@/lib/types";

interface FormState {
  employee_id: string;
  leave_type_id: string;
  year: string;
  days_delta: string;
  amount_delta: string;
  reason: string;
}

const todayYear = new Date().getFullYear();

const empty: FormState = {
  employee_id: "",
  leave_type_id: "",
  year: String(todayYear),
  days_delta: "0",
  amount_delta: "0",
  reason: "",
};

export function LeaveAdjustmentCreatePage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(empty);

  const empQ = useQuery({
    queryKey: ["employees", "for-leave-adj"],
    queryFn: async () =>
      (await api.get<Page<Employee>>("/employees", { params: { size: 200, is_active: true } })).data,
  });
  const typesQ = useQuery({
    queryKey: ["leave-types"],
    queryFn: async () => (await api.get<LeaveType[]>("/leave-types")).data,
  });

  const types = (typesQ.data ?? []).filter((t) => t.is_active);
  const selectedType = useMemo(
    () => types.find((tp) => tp.id === form.leave_type_id) ?? null,
    [types, form.leave_type_id]
  );

  const mut = useMutation({
    mutationFn: async () =>
      (
        await api.post<LeaveAdjustment>("/leave-adjustments", {
          employee_id: form.employee_id,
          leave_type_id: form.leave_type_id,
          year: Number(form.year),
          days_delta: Number(form.days_delta) || 0,
          amount_delta: Number(form.amount_delta) || 0,
          reason: form.reason.trim() || null,
        })
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leave-balances"] });
      qc.invalidateQueries({ queryKey: ["leave-adjustments"] });
      nav("/app/leaves?tab=balances");
    },
  });

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const days = Number(form.days_delta) || 0;
  const amount = Number(form.amount_delta) || 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("leaves.adjust_create_title")}
        breadcrumbs={[
          { label: t("leaves.title"), to: "/app/leaves?tab=balances" },
          { label: t("leaves.adjust_create_title") },
        ]}
        icon={<Sigma className="size-5" />}
        description={t("leaves.adjust_create_subtitle")}
      />

      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          mut.mutate();
        }}
      >
        <Card>
          <div className="space-y-5 p-6">
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <p>{t("leaves.adjust_warning")}</p>
            </div>

            <div>
              <label className="label">{t("leaves.employee")}</label>
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

            <div>
              <label className="label">{t("leaves.type")}</label>
              <select
                className="input"
                value={form.leave_type_id}
                onChange={(e) => set("leave_type_id", e.target.value)}
                required
              >
                <option value="">— {t("common.select")} —</option>
                {types.map((tp) => (
                  <option key={tp.id} value={tp.id}>
                    {tp.name}
                    {tp.paid ? ` · ${t("leaves.paid_short")}` : ` · ${t("leaves.unpaid_short")}`}
                  </option>
                ))}
              </select>
              {selectedType && !selectedType.paid && Number(form.amount_delta) !== 0 && (
                <p className="mt-1 inline-flex items-center gap-1 text-xs text-amber-700">
                  <Info className="size-3" />
                  {t("leaves.adjust_unpaid_amount_note")}
                </p>
              )}
            </div>

            <Input
              label={t("leaves.adjust_year")}
              type="number"
              min="2000"
              max="2100"
              value={form.year}
              onChange={(e) => set("year", e.target.value)}
              required
              hint={t("leaves.adjust_year_hint") ?? undefined}
            />
          </div>
        </Card>

        <Card>
          <div className="space-y-5 p-6">
            <div className="flex items-center gap-3">
              <span className="flex size-7 items-center justify-center rounded-md bg-brand-50 text-brand-700">
                <Sigma className="size-4" />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-slate-700">
                  {t("leaves.adjust_section_delta")}
                </h2>
                <p className="text-xs text-slate-500">
                  {t("leaves.adjust_section_delta_hint")}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label={t("leaves.adjust_days_delta")}
                type="number"
                step="1"
                value={form.days_delta}
                onChange={(e) => set("days_delta", e.target.value)}
                prefix={<CalendarDays className="size-4" />}
                suffix={<span className="text-xs">{t("leaves.days_count")}</span>}
                hint={t("leaves.adjust_days_hint") ?? undefined}
              />
              <Input
                label={t("leaves.adjust_amount_delta")}
                type="number"
                step="1000"
                value={form.amount_delta}
                onChange={(e) => set("amount_delta", e.target.value)}
                prefix={<Banknote className="size-4" />}
                suffix={<span className="text-xs">{t("employees.currency_short")}</span>}
                hint={t("leaves.adjust_amount_hint") ?? undefined}
              />
            </div>

            <div
              className={
                days >= 0 && amount >= 0
                  ? "rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"
                  : "rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800"
              }
            >
              <Coins className="mr-1 inline size-3" />
              {days >= 0
                ? t("leaves.adjust_summary_add", { days, amount })
                : t("leaves.adjust_summary_sub", { days: Math.abs(days), amount: Math.abs(amount) })}
            </div>
          </div>
        </Card>

        <Card>
          <div className="space-y-3 p-6">
            <h2 className="text-sm font-semibold text-slate-700">
              {t("leaves.reason")}
            </h2>
            <Input
              label={t("leaves.reason")}
              value={form.reason}
              onChange={(e) => set("reason", e.target.value)}
              maxLength={500}
              placeholder={t("leaves.adjust_reason_placeholder") ?? ""}
              required
            />
          </div>
        </Card>

        {mut.isError && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {apiErrorMessage(mut.error)}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => nav("/app/leaves?tab=balances")}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" loading={mut.isPending}>
            {t("common.create")}
          </Button>
        </div>
      </form>
    </div>
  );
}
