import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Clock,
  Coffee,
  ListChecks,
  Sunrise,
  Sunset,
  Timer,
} from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { useEnumLabel } from "@/lib/enum";
import type { ShiftTemplate, ShiftType } from "@/lib/types";

export interface TemplateFormValue {
  name: string;
  type: ShiftType;
  start_time: string; // "HH:MM"
  end_time: string;
  break_minutes: string;
  expected_hours: string;
  allow_overtime: boolean;
  /** ISO weekdays (1=Mon … 7=Sun) the template is in service on. */
  working_days: number[];
}

export const emptyTemplateForm: TemplateFormValue = {
  name: "",
  type: "FIXED",
  start_time: "09:00",
  end_time: "18:00",
  break_minutes: "60",
  expected_hours: "8",
  allow_overtime: true,
  working_days: [1, 2, 3, 4, 5, 6],
};

export function templateToForm(t: ShiftTemplate): TemplateFormValue {
  return {
    name: t.name,
    type: t.type,
    start_time: t.start_time?.slice(0, 5) ?? "",
    end_time: t.end_time?.slice(0, 5) ?? "",
    break_minutes: String(t.break_minutes),
    expected_hours: t.expected_hours ?? "",
    allow_overtime: t.allow_overtime,
    working_days: t.working_days?.length ? [...t.working_days] : [1, 2, 3, 4, 5, 6],
  };
}

export function templateFormToBody(f: TemplateFormValue) {
  return {
    name: f.name.trim(),
    type: f.type,
    start_time: f.start_time ? `${f.start_time}:00` : null,
    end_time: f.end_time ? `${f.end_time}:00` : null,
    break_minutes: Number(f.break_minutes) || 0,
    expected_hours: f.expected_hours || undefined,
    allow_overtime: f.allow_overtime,
    working_days: [...f.working_days].sort((a, b) => a - b),
  };
}

interface Props {
  value: TemplateFormValue;
  onChange: (next: TemplateFormValue) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitting: boolean;
  submitLabel: string;
  errorMessage?: string | null;
  isEdit?: boolean;
}

/** Compute the derived "duration minus break" in hours from start/end/break.
 * Used so the admin can sanity-check the expected_hours they typed. */
function computeRawHours(start: string, end: string, breakMin: number): number | null {
  if (!start || !end) return null;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return null;
  let mins = (eh - sh) * 60 + (em - sm);
  // Handle overnight shifts (e.g. 22:00 → 06:00)
  if (mins < 0) mins += 24 * 60;
  mins -= breakMin;
  if (mins <= 0) return 0;
  return Math.round((mins / 60) * 100) / 100;
}

export function TemplateForm({
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
  const label = useEnumLabel();
  const set = <K extends keyof TemplateFormValue>(k: K, v: TemplateFormValue[K]) =>
    onChange({ ...value, [k]: v });

  const computedHours = useMemo(
    () => computeRawHours(value.start_time, value.end_time, Number(value.break_minutes) || 0),
    [value.start_time, value.end_time, value.break_minutes]
  );

  const expected = Number(value.expected_hours);
  const expectedMatches =
    !value.expected_hours ||
    computedHours == null ||
    Math.abs(computedHours - expected) < 0.05;

  const overnight = useMemo(() => {
    if (!value.start_time || !value.end_time) return false;
    return value.start_time >= value.end_time;
  }, [value.start_time, value.end_time]);

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {/* Section 1: Identity */}
      <Card>
        <div className="space-y-5 p-6">
          <SectionHead
            icon={<ListChecks className="size-4" />}
            title={t("shifts_page.section_basics")}
            hint={t("shifts_page.section_basics_hint")}
          />

          <Input
            label={t("shifts_page.template_name")}
            value={value.name}
            onChange={(e) => set("name", e.target.value)}
            required
            maxLength={100}
            placeholder={t("shifts_page.template_name_placeholder") ?? ""}
          />

          <div>
            <label className="label">{t("shifts_page.type")}</label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {(["FIXED", "FLEXIBLE", "SPLIT"] as ShiftType[]).map((tp) => (
                <button
                  key={tp}
                  type="button"
                  onClick={() => set("type", tp)}
                  className={
                    value.type === tp
                      ? "rounded-lg border-2 border-brand-500 bg-brand-50 p-3 text-left ring-2 ring-brand-200"
                      : "rounded-lg border border-slate-200 bg-white p-3 text-left hover:border-slate-300"
                  }
                >
                  <div className="text-sm font-semibold text-slate-800">
                    {label("shift_type", tp)}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {t(`shifts_page.type_${tp.toLowerCase()}_hint`)}
                  </p>
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* Section 2: Times */}
      <Card>
        <div className="space-y-5 p-6">
          <SectionHead
            icon={<Clock className="size-4" />}
            title={t("shifts_page.section_times")}
            hint={t("shifts_page.section_times_hint")}
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label={t("shifts_page.start")}
              type="time"
              value={value.start_time}
              onChange={(e) => set("start_time", e.target.value)}
              prefix={<Sunrise className="size-4" />}
              required={value.type === "FIXED"}
            />
            <Input
              label={t("shifts_page.end")}
              type="time"
              value={value.end_time}
              onChange={(e) => set("end_time", e.target.value)}
              prefix={<Sunset className="size-4" />}
              required={value.type === "FIXED"}
            />
          </div>

          {overnight && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {t("shifts_page.overnight_warning")}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label={t("shifts_page.break_minutes")}
              type="number"
              min="0"
              max="480"
              step="5"
              value={value.break_minutes}
              onChange={(e) => set("break_minutes", e.target.value)}
              prefix={<Coffee className="size-4" />}
              suffix={<span className="text-xs">{t("shifts_page.minutes_short")}</span>}
              hint={t("shifts_page.break_hint") ?? undefined}
            />
            <Input
              label={t("shifts_page.expected_hours")}
              type="number"
              min="0"
              max="24"
              step="0.5"
              value={value.expected_hours}
              onChange={(e) => set("expected_hours", e.target.value)}
              prefix={<Timer className="size-4" />}
              suffix={<span className="text-xs">{t("shifts_page.hours_short")}</span>}
              hint={t("shifts_page.expected_hours_hint") ?? undefined}
            />
          </div>

          {/* Computed-vs-typed sanity strip */}
          {value.start_time && value.end_time && computedHours !== null && (
            <div
              className={
                expectedMatches
                  ? "rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"
                  : "rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
              }
            >
              {expectedMatches
                ? t("shifts_page.computed_match", { hours: computedHours })
                : t("shifts_page.computed_mismatch", {
                    computed: computedHours,
                    typed: expected,
                  })}
            </div>
          )}
        </div>
      </Card>

      {/* Section 3: Working days */}
      <Card>
        <div className="space-y-4 p-6">
          <SectionHead
            icon={<ListChecks className="size-4" />}
            title={t("shifts_page.section_working_days")}
            hint={t("shifts_page.section_working_days_hint")}
          />
          <WorkingDaysPicker
            selected={value.working_days}
            onChange={(next) => set("working_days", next)}
          />
        </div>
      </Card>

      {/* Section 4: Rules */}
      <Card>
        <div className="space-y-3 p-6">
          <SectionHead
            icon={<ListChecks className="size-4" />}
            title={t("shifts_page.section_rules")}
            hint={t("shifts_page.section_rules_hint")}
          />
          <label className="flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 hover:border-slate-300">
            <input
              type="checkbox"
              className="mt-0.5 size-4 rounded border-slate-300 text-brand-600"
              checked={value.allow_overtime}
              onChange={(e) => set("allow_overtime", e.target.checked)}
            />
            <span>
              <span className="block text-sm font-medium text-slate-800">
                {t("shifts_page.allow_overtime")}
              </span>
              <span className="block text-xs text-slate-500">
                {t("shifts_page.allow_overtime_hint")}
              </span>
            </span>
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
      {void isEdit /* reserved for future edit-only logic */}
    </form>
  );
}

function SectionHead({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex size-7 items-center justify-center rounded-md bg-brand-50 text-brand-600">
        {icon}
      </span>
      <div>
        <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
        {hint && <p className="text-xs text-slate-500">{hint}</p>}
      </div>
    </div>
  );
}

const WEEKDAY_ISO = [1, 2, 3, 4, 5, 6, 7];

function WorkingDaysPicker({
  selected,
  onChange,
}: {
  selected: number[];
  onChange: (next: number[]) => void;
}) {
  const { t } = useTranslation();
  const set = new Set(selected);
  const toggle = (iso: number) => {
    const next = new Set(set);
    if (next.has(iso)) next.delete(iso);
    else next.add(iso);
    onChange([...next].sort((a, b) => a - b));
  };
  const preset = (days: number[]) => onChange([...days].sort((a, b) => a - b));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-7 gap-2">
        {WEEKDAY_ISO.map((iso) => {
          const on = set.has(iso);
          return (
            <button
              key={iso}
              type="button"
              onClick={() => toggle(iso)}
              className={
                on
                  ? "rounded-lg border-2 border-brand-500 bg-brand-50 px-2 py-3 text-center text-xs font-bold text-brand-700 ring-2 ring-brand-200"
                  : "rounded-lg border border-slate-200 bg-white px-2 py-3 text-center text-xs font-medium text-slate-600 hover:border-slate-300"
              }
            >
              {t(`weekday_short.${iso}`)}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => preset([1, 2, 3, 4, 5])}
          className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-600 hover:border-slate-300"
        >
          {t("shifts_page.preset_mon_fri")}
        </button>
        <button
          type="button"
          onClick={() => preset([1, 2, 3, 4, 5, 6])}
          className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-600 hover:border-slate-300"
        >
          {t("shifts_page.preset_mon_sat")}
        </button>
        <button
          type="button"
          onClick={() => preset([1, 2, 3, 4, 5, 6, 7])}
          className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-600 hover:border-slate-300"
        >
          {t("shifts_page.preset_all_week")}
        </button>
      </div>
      {set.size === 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {t("shifts_page.working_days_empty_warning")}
        </div>
      )}
    </div>
  );
}
