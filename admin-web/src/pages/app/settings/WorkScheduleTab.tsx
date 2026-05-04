import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Calendar, Save } from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/cn";
import type { Company } from "@/lib/types";

import { Section } from "./components";

type Iso = 1 | 2 | 3 | 4 | 5 | 6 | 7;
const WEEKDAYS: Iso[] = [1, 2, 3, 4, 5, 6, 7];

interface FormState {
  working_days: number[];
  working_hours_per_day: string;
  default_shift_start: string;
  default_shift_end: string;
}

function fromCompany(c: Company): FormState {
  const s = (c.settings ?? {}) as Record<string, unknown>;
  const wd = Array.isArray(s.working_days)
    ? (s.working_days as number[])
    : [1, 2, 3, 4, 5];
  return {
    working_days: wd,
    working_hours_per_day: String(s.working_hours_per_day ?? 8),
    default_shift_start: String(s.default_shift_start ?? "09:00"),
    default_shift_end: String(s.default_shift_end ?? "18:00"),
  };
}

export function WorkScheduleTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState | null>(null);

  const companyQ = useQuery({
    queryKey: ["company", "me"],
    queryFn: async () => (await api.get<Company>("/companies/me")).data,
  });

  useEffect(() => {
    if (companyQ.data && form === null) {
      setForm(fromCompany(companyQ.data));
    }
  }, [companyQ.data, form]);

  const saveMut = useMutation({
    mutationFn: async (f: FormState) => {
      const existing =
        (companyQ.data?.settings ?? {}) as Record<string, unknown>;
      const settings = {
        ...existing,
        working_days: [...f.working_days].sort(),
        working_hours_per_day: Number(f.working_hours_per_day),
        default_shift_start: f.default_shift_start,
        default_shift_end: f.default_shift_end,
      };
      return (await api.patch<Company>("/companies/me", { settings })).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["company"] });
      toast.success(t("settings_page.saved"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const presetWorkdays = useMemo(
    () =>
      [
        { key: "mon_fri", days: [1, 2, 3, 4, 5] },
        { key: "mon_sat", days: [1, 2, 3, 4, 5, 6] },
        { key: "mon_sun", days: [1, 2, 3, 4, 5, 6, 7] },
      ] as const,
    []
  );

  if (!form) {
    return <p className="text-sm text-slate-500">{t("common.loading")}</p>;
  }

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));

  const toggleDay = (iso: Iso) => {
    if (!form) return;
    update(
      "working_days",
      form.working_days.includes(iso)
        ? form.working_days.filter((d) => d !== iso)
        : [...form.working_days, iso].sort()
    );
  };

  const setPreset = (days: number[]) => update("working_days", days);

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (form) saveMut.mutate(form);
      }}
    >
      <Section
        title={t("settings_page.section_working_days")}
        hint={t("settings_page.section_working_days_hint")}
      >
        {/* Quick presets */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-wide text-slate-500">
            {t("settings_page.preset")}:
          </span>
          {presetWorkdays.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPreset([...p.days])}
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700 hover:border-brand-300 hover:bg-brand-50/50"
            >
              {t(`settings_page.preset_${p.key}` as never)}
            </button>
          ))}
        </div>
        {/* Day toggle pills */}
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map((iso) => {
            const on = form.working_days.includes(iso);
            const isWeekend = iso === 6 || iso === 7;
            return (
              <button
                key={iso}
                type="button"
                onClick={() => toggleDay(iso)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-xs font-semibold transition",
                  on
                    ? "border-brand-600 bg-brand-600 text-white shadow-sm shadow-brand-600/30"
                    : isWeekend
                      ? "border-rose-200 bg-rose-50/40 text-rose-700 hover:bg-rose-50"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                )}
              >
                <Calendar className="size-3.5 opacity-70" />
                {t(`weekday_short.${iso}`)}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-slate-500">
          {t("settings_page.working_days_hint")}
        </p>
      </Section>

      <Section
        title={t("settings_page.section_work_hours")}
        hint={t("settings_page.section_work_hours_hint")}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Input
            type="number"
            min={1}
            max={24}
            step="0.5"
            label={t("settings_page.working_hours_per_day")}
            hint={t("settings_page.working_hours_hint") ?? undefined}
            value={form.working_hours_per_day}
            onChange={(e) => update("working_hours_per_day", e.target.value)}
          />
          <Input
            type="time"
            label={t("settings_page.default_shift_start")}
            value={form.default_shift_start}
            onChange={(e) => update("default_shift_start", e.target.value)}
          />
          <Input
            type="time"
            label={t("settings_page.default_shift_end")}
            value={form.default_shift_end}
            onChange={(e) => update("default_shift_end", e.target.value)}
          />
        </div>
        <p className="text-[11px] text-slate-500">
          {t("settings_page.shift_default_hint")}
        </p>
      </Section>

      <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
        <Button type="submit" loading={saveMut.isPending}>
          <Save className="size-4" />
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}
