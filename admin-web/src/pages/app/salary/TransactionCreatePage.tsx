import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Banknote,
  CalendarClock,
  CreditCard,
  Hash,
  StickyNote,
  Wallet,
} from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/PageHeader";
import { useEnumLabel } from "@/lib/enum";
import type {
  Employee,
  Page,
  SalaryPeriod,
  SalaryTransaction,
  TransactionType,
} from "@/lib/types";

import { fmtMoneyZero } from "./utils";

interface FormState {
  employee_id: string;
  type: TransactionType;
  amount: string;
  paid_at: string;
  payment_method: string;
  reference: string;
  notes: string;
  // year/month derived from paid_at; period_id is auto-resolved on submit.
}

const todayIso = () => new Date().toISOString().slice(0, 10);

const empty: FormState = {
  employee_id: "",
  type: "ADVANCE",
  amount: "",
  paid_at: todayIso(),
  payment_method: "",
  reference: "",
  notes: "",
};

export function TransactionCreatePage() {
  const { t } = useTranslation();
  const label = useEnumLabel();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();

  const [form, setForm] = useState<FormState>(() => ({
    ...empty,
    employee_id: params.get("employee_id") ?? "",
  }));
  const periodIdHint = params.get("period_id");

  useEffect(() => {
    if (params.get("employee_id") && !form.employee_id) {
      setForm((f) => ({ ...f, employee_id: params.get("employee_id") ?? "" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const empQ = useQuery({
    queryKey: ["employees", "for-tx-create"],
    queryFn: async () =>
      (await api.get<Page<Employee>>("/employees", { params: { size: 200, is_active: true } })).data,
  });

  // Resolve the period id: if the URL passed one, use it; otherwise look up
  // the (employee, year, month) from paid_at. Employer can still pay without
  // a matching period — backend accepts period_id=null.
  const dt = useMemo(() => {
    const d = new Date(form.paid_at);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  }, [form.paid_at]);

  const periodLookupQ = useQuery({
    queryKey: ["salary", "period-lookup", form.employee_id, dt.year, dt.month],
    queryFn: async () => {
      try {
        return (
          await api.get<SalaryPeriod>(
            `/salary/employee/${form.employee_id}/period/${dt.year}/${dt.month}`
          )
        ).data;
      } catch {
        return null;
      }
    },
    enabled: !!form.employee_id && !periodIdHint,
  });

  const resolvedPeriodId = periodIdHint || periodLookupQ.data?.id || null;

  const mut = useMutation({
    mutationFn: async () =>
      (
        await api.post<SalaryTransaction>("/salary/transactions", {
          employee_id: form.employee_id,
          period_id: resolvedPeriodId,
          type: form.type,
          amount: Number(form.amount) || 0,
          paid_at: new Date(form.paid_at).toISOString(),
          payment_method: form.payment_method.trim() || null,
          reference: form.reference.trim() || null,
          notes: form.notes.trim() || null,
        })
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["salary"] });
      nav("/app/salary?tab=transactions");
    },
  });

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const selectedEmployee = empQ.data?.items.find((e) => e.id === form.employee_id) ?? null;
  const period = periodLookupQ.data ?? null;
  const pending = period
    ? Number(period.total_earned) - Number(period.paid_amount)
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("salary_page.tx_create_title")}
        breadcrumbs={[
          { label: t("salary_page.title"), to: "/app/salary?tab=transactions" },
          { label: t("salary_page.tx_create_title") },
        ]}
        icon={<CreditCard className="size-5" />}
        description={t("salary_page.tx_create_subtitle")}
      />

      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          mut.mutate();
        }}
      >
        {/* Section 1 — Who, what type */}
        <Card>
          <div className="space-y-5 p-6">
            <div>
              <h2 className="text-sm font-semibold text-slate-700">
                {t("salary_page.tx_section_what")}
              </h2>
              <p className="text-xs text-slate-500">
                {t("salary_page.tx_section_what_hint")}
              </p>
            </div>

            <div>
              <label className="label">{t("salary_page.employee")}</label>
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
              <label className="label">{t("salary_page.payment_type")}</label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {(["ADVANCE", "FULL_PAYMENT", "BONUS"] as TransactionType[]).map((tp) => (
                  <button
                    key={tp}
                    type="button"
                    onClick={() => set("type", tp)}
                    className={
                      form.type === tp
                        ? "rounded-lg border-2 border-brand-500 bg-brand-50 p-3 text-left ring-2 ring-brand-200"
                        : "rounded-lg border border-slate-200 bg-white p-3 text-left hover:border-slate-300"
                    }
                  >
                    <div className="text-sm font-semibold text-slate-800">
                      {label("transaction_type", tp)}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {t(`salary_page.payment_type_${tp.toLowerCase()}_hint`)}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Card>

        {/* Section 2 — Amount + when */}
        <Card>
          <div className="space-y-5 p-6">
            <div>
              <h2 className="text-sm font-semibold text-slate-700">
                {t("salary_page.tx_section_amount")}
              </h2>
              <p className="text-xs text-slate-500">
                {t("salary_page.tx_section_amount_hint")}
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label={t("employees.amount")}
                type="number"
                min="0"
                step="1000"
                value={form.amount}
                onChange={(e) => set("amount", e.target.value)}
                required
                prefix={<Banknote className="size-4" />}
                suffix={<span className="text-xs">{t("employees.currency_short")}</span>}
              />
              <Input
                label={t("salary_page.paid_at")}
                type="date"
                value={form.paid_at}
                onChange={(e) => set("paid_at", e.target.value)}
                required
                prefix={<CalendarClock className="size-4" />}
              />
            </div>

            {selectedEmployee && period && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                <Wallet className="mr-1 inline size-3" />
                {t("salary_page.tx_period_resolved", {
                  period: `${dt.year}/${String(dt.month).padStart(2, "0")}`,
                  total: fmtMoneyZero(period.total_earned),
                  pending: fmtMoneyZero(pending ?? 0),
                })}
              </div>
            )}
            {selectedEmployee && !period && form.employee_id && !periodLookupQ.isLoading && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <AlertTriangle className="mt-0.5 mr-1 inline size-3" />
                {t("salary_page.tx_no_period")}
              </div>
            )}
          </div>
        </Card>

        {/* Section 3 — Method / reference / notes */}
        <Card>
          <div className="space-y-5 p-6">
            <div>
              <h2 className="text-sm font-semibold text-slate-700">
                {t("salary_page.tx_section_meta")}
              </h2>
              <p className="text-xs text-slate-500">
                {t("salary_page.tx_section_meta_hint")}
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label={t("salary_page.payment_method")}
                value={form.payment_method}
                onChange={(e) => set("payment_method", e.target.value)}
                placeholder={t("salary_page.payment_method_placeholder") ?? ""}
                maxLength={32}
                prefix={<CreditCard className="size-4" />}
              />
              <Input
                label={t("salary_page.payment_reference")}
                value={form.reference}
                onChange={(e) => set("reference", e.target.value)}
                placeholder={t("salary_page.payment_reference_placeholder") ?? ""}
                maxLength={255}
                prefix={<Hash className="size-4" />}
              />
            </div>

            <div>
              <label className="label">{t("attendance.notes")}</label>
              <textarea
                className="input min-h-[88px] resize-y py-2"
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
                maxLength={500}
                placeholder={t("salary_page.payment_notes_placeholder") ?? ""}
              />
            </div>
          </div>
        </Card>

        {mut.isError && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {apiErrorMessage(mut.error)}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => nav("/app/salary?tab=transactions")}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" loading={mut.isPending}>
            {t("common.create")}
          </Button>
        </div>
      </form>
      {void StickyNote /* reserved for future receipt upload */}
    </div>
  );
}
