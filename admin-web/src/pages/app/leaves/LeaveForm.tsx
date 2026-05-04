import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Banknote,
  CalendarDays,
  CheckCircle2,
  Coins,
  Edit2,
  RotateCcw,
  Sparkles,
} from "lucide-react";

import { api } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import type {
  Company,
  Employee,
  LeaveType,
  Page,
  ShiftTemplate,
} from "@/lib/types";

import {
  fmtMoney,
  hoursPerDayFromTemplate,
  perDayBase,
  workingDaysFromCompany,
} from "./salaryImpact";

export interface LeaveFormValue {
  employee_id: string;
  leave_type_id: string;
  start_date: string;
  end_date: string;
  reason: string;
  decision_note: string;
  auto_approve: boolean;
  /** Empty string = use auto-computed; non-empty = override total UZS. */
  override_amount: string;
}

export const emptyLeaveForm: LeaveFormValue = {
  employee_id: "",
  leave_type_id: "",
  start_date: new Date().toISOString().slice(0, 10),
  end_date: new Date().toISOString().slice(0, 10),
  reason: "",
  decision_note: "",
  auto_approve: true,
  override_amount: "",
};

interface Props {
  value: LeaveFormValue;
  onChange: (next: LeaveFormValue) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitting: boolean;
  submitLabel: string;
  errorMessage?: string | null;
  /** True on Edit — locks the employee and dates. */
  isEdit?: boolean;
}

export function LeaveForm({
  value,
  onChange,
  onSubmit,
  onCancel,
  submitting,
  submitLabel,
  errorMessage,
  isEdit,
}: Props) {
  const { t } = useTranslation();

  const empQ = useQuery({
    queryKey: ["employees", "for-leave-form"],
    queryFn: async () =>
      (
        await api.get<Page<Employee>>("/employees", {
          params: { size: 200, is_active: true },
        })
      ).data,
  });
  const typesQ = useQuery({
    queryKey: ["leave-types"],
    queryFn: async () => (await api.get<LeaveType[]>("/leave-types")).data,
  });
  const companyQ = useQuery({
    queryKey: ["company", "me"],
    queryFn: async () => (await api.get<Company>("/companies/me")).data,
  });
  const templatesQ = useQuery({
    queryKey: ["shift-templates", "for-leave-form"],
    queryFn: async () =>
      (await api.get<Page<ShiftTemplate>>("/shifts/templates", { params: { size: 100 } })).data,
  });

  const employees = empQ.data?.items ?? [];
  const types = (typesQ.data ?? []).filter((t) => t.is_active);
  const employee = useMemo(
    () => employees.find((e) => e.id === value.employee_id) ?? null,
    [employees, value.employee_id]
  );
  const selectedType = useMemo(
    () => types.find((tp) => tp.id === value.leave_type_id) ?? null,
    [types, value.leave_type_id]
  );
  const selectedTemplate = useMemo(
    () =>
      employee?.shift_template_id
        ? (templatesQ.data?.items ?? []).find((tp) => tp.id === employee.shift_template_id)
        : null,
    [employee, templatesQ.data]
  );

  const days = useMemo(() => {
    if (!value.start_date || !value.end_date) return 0;
    const a = new Date(value.start_date);
    const b = new Date(value.end_date);
    if (b < a) return 0;
    return Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
  }, [value.start_date, value.end_date]);

  // Auto-computed daily and total — always shown so the admin sees the
  // baseline even when an override is in effect.
  const dailyBase = useMemo(() => {
    if (!employee) return 0;
    return perDayBase({
      employee,
      hoursPerDay: hoursPerDayFromTemplate(selectedTemplate ?? null),
      daysPerMonth: workingDaysFromCompany(companyQ.data),
    });
  }, [employee, selectedTemplate, companyQ.data]);
  const autoTotal = dailyBase * days;
  const isPaid = !!selectedType?.paid;

  // Override editing toggle. We keep the toggle in local UI state so that
  // turning it off clears the value in the form too.
  const [editingOverride, setEditingOverride] = useState(value.override_amount !== "");
  useEffect(() => {
    if (value.override_amount !== "") setEditingOverride(true);
  }, [value.override_amount]);

  const overrideTotal = value.override_amount ? Number(value.override_amount) : null;
  const overrideDaily =
    overrideTotal != null && days > 0 ? overrideTotal / days : null;
  const isOverridden = overrideTotal != null;

  const set = <K extends keyof LeaveFormValue>(k: K, v: LeaveFormValue[K]) =>
    onChange({ ...value, [k]: v });

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {/* Section 1: Who & when */}
      <Card>
        <div className="space-y-5 p-6">
          <div>
            <h2 className="text-sm font-semibold text-slate-700">
              {t("leaves.section_who_when")}
            </h2>
            <p className="text-xs text-slate-500">
              {t("leaves.section_who_when_hint")}
            </p>
          </div>

          <div>
            <label className="label">{t("leaves.employee")}</label>
            <select
              className="input"
              value={value.employee_id}
              onChange={(e) => set("employee_id", e.target.value)}
              required
              disabled={!!isEdit}
            >
              <option value="">— {t("common.select")} —</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.full_name} ({e.employee_code})
                </option>
              ))}
            </select>
            {isEdit && (
              <p className="mt-1 text-xs text-slate-500">{t("leaves.employee_locked")}</p>
            )}
          </div>

          <div>
            <label className="label">{t("leaves.type")}</label>
            <select
              className="input"
              value={value.leave_type_id}
              onChange={(e) => set("leave_type_id", e.target.value)}
              required
            >
              <option value="">— {t("common.select")} —</option>
              {types.map((tp) => (
                <option key={tp.id} value={tp.id}>
                  {tp.name} {tp.paid ? `· ${t("leaves.paid_short")}` : `· ${t("leaves.unpaid_short")}`}
                  {tp.max_days_per_year ? ` · max ${tp.max_days_per_year}d` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label={t("leaves.start_date")}
              type="date"
              value={value.start_date}
              onChange={(e) => set("start_date", e.target.value)}
              required
              disabled={!!isEdit}
            />
            <Input
              label={t("leaves.end_date")}
              type="date"
              value={value.end_date}
              onChange={(e) => set("end_date", e.target.value)}
              required
              disabled={!!isEdit}
            />
          </div>
          {days > 0 && (
            <div className="inline-flex items-center gap-1.5 rounded-md bg-slate-50 px-2.5 py-1 text-xs">
              <CalendarDays className="size-3.5 text-slate-500" />
              <span className="font-semibold text-slate-700">{days}</span>
              <span className="text-slate-500">{t("leaves.days_count")}</span>
            </div>
          )}
        </div>
      </Card>

      {/* Section 2: Salary impact */}
      <Card>
        <div className="space-y-4 p-6">
          <div className="flex items-center gap-3">
            <span className="flex size-7 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
              <Coins className="size-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-slate-700">
                {t("leaves.section_salary_impact")}
              </h2>
              <p className="text-xs text-slate-500">
                {t("leaves.section_salary_impact_hint")}
              </p>
            </div>
          </div>

          {!employee || !selectedType ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              {t("leaves.salary_impact_pick_first")}
            </div>
          ) : !isPaid ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <span className="font-semibold text-slate-700">{t("leaves.unpaid")}.</span>{" "}
              {t("leaves.salary_impact_unpaid_full")}
            </div>
          ) : (
            <>
              {/* Auto-calculated card (yashil) */}
              <div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-emerald-100/60 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-700">
                    <Sparkles className="size-3.5" />
                    {t("leaves.auto_calculated")}
                  </div>
                  {!isOverridden && (
                    <Badge tone="success">
                      <CheckCircle2 className="mr-0.5 inline size-3" />
                      {t("leaves.original")}
                    </Badge>
                  )}
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Tile label={t("leaves.daily_rate")} value={fmtMoney(dailyBase)} />
                  <Tile label={t("leaves.days_count_label")} value={String(days)} primary />
                  <Tile
                    label={t("leaves.total")}
                    value={fmtMoney(autoTotal)}
                    primary={!isOverridden}
                  />
                </div>
              </div>

              {/* Override block */}
              {!editingOverride ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setEditingOverride(true)}
                >
                  <Edit2 className="size-3.5" />
                  {t("leaves.override_button")}
                </Button>
              ) : (
                <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-800">
                      <Edit2 className="size-3.5" />
                      {t("leaves.override_block_title")}
                    </div>
                    {isOverridden && <Badge tone="warning">{t("leaves.overridden")}</Badge>}
                  </div>
                  <div className="mt-2 flex flex-wrap items-end gap-3">
                    <Input
                      label={t("leaves.override_total")}
                      type="number"
                      min="0"
                      step="1000"
                      value={value.override_amount}
                      onChange={(e) => set("override_amount", e.target.value)}
                      placeholder={String(Math.round(autoTotal))}
                      prefix={<Banknote className="size-4" />}
                      suffix={
                        <span className="text-xs">{t("employees.currency_short")}</span>
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        set("override_amount", "");
                        setEditingOverride(false);
                      }}
                    >
                      <RotateCcw className="size-3.5" />
                      {t("leaves.reset_to_auto")}
                    </Button>
                  </div>
                  {overrideTotal != null && days > 0 && (
                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <Tile label={t("leaves.daily_rate")} value={fmtMoney(overrideDaily ?? 0)} tone="amber" />
                      <Tile label={t("leaves.days_count_label")} value={String(days)} tone="amber" />
                      <Tile label={t("leaves.total")} value={fmtMoney(overrideTotal)} tone="amber" primary />
                    </div>
                  )}
                  <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-amber-700/80">
                    <AlertTriangle className="size-3" />
                    {t("leaves.override_warning")}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </Card>

      {/* Section 3: Notes */}
      <Card>
        <div className="space-y-4 p-6">
          <h2 className="text-sm font-semibold text-slate-700">
            {t("leaves.section_notes")}
          </h2>
          <Input
            label={t("leaves.reason")}
            value={value.reason}
            onChange={(e) => set("reason", e.target.value)}
            maxLength={500}
            placeholder={t("leaves.reason_placeholder") ?? ""}
          />
          <Input
            label={t("leaves.decision_note")}
            value={value.decision_note}
            onChange={(e) => set("decision_note", e.target.value)}
            maxLength={500}
            placeholder={t("leaves.decision_note_placeholder") ?? ""}
          />

          {!isEdit && (
            <label className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3">
              <input
                type="checkbox"
                className="mt-0.5 size-4 rounded border-emerald-300 text-emerald-600"
                checked={value.auto_approve}
                onChange={(e) => set("auto_approve", e.target.checked)}
              />
              <div>
                <div className="flex items-center gap-1.5 text-sm font-medium text-emerald-900">
                  <CheckCircle2 className="size-3.5" />
                  {t("leaves.auto_approve")}
                </div>
                <div className="text-xs text-emerald-700">
                  {t("leaves.auto_approve_hint")}
                </div>
              </div>
            </label>
          )}
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

function Tile({
  label,
  value,
  primary,
  tone = "emerald",
}: {
  label: string;
  value: string;
  primary?: boolean;
  tone?: "emerald" | "amber";
}) {
  const cls = tone === "amber"
    ? "bg-white/70 ring-amber-200"
    : "bg-white/70 ring-emerald-200";
  const ring = primary
    ? tone === "amber"
      ? "ring-2 ring-amber-500"
      : "ring-2 ring-emerald-500"
    : "ring-1";
  const text = tone === "amber" ? "text-amber-900" : "text-emerald-900";
  const subText = tone === "amber" ? "text-amber-700/70" : "text-emerald-700/70";
  return (
    <div className={cn("rounded-md px-3 py-2", cls, ring)}>
      <div className={cn("text-[10px] uppercase tracking-wide", subText)}>{label}</div>
      <div className={cn("mt-0.5 text-sm font-semibold tabular-nums", text)}>
        {value}
      </div>
    </div>
  );
}
