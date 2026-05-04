import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Save } from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { Company } from "@/lib/types";

import { Section } from "./components";

interface FormState {
  late_threshold_min: string;
  late_penalty_per_min: string;
  overtime_after_hours: string;
  geofence_radius_m: string;
  face_match_threshold: string;
  max_devices_per_employee: string;
  absence_penalty_enabled: boolean;
}

function fromCompany(c: Company): FormState {
  const s = (c.settings ?? {}) as Record<string, unknown>;
  return {
    late_threshold_min: String(s.late_threshold_min ?? 5),
    late_penalty_per_min: String(s.late_penalty_per_min ?? 0),
    overtime_after_hours: String(s.overtime_after_hours ?? 8),
    geofence_radius_m: String(s.geofence_radius_m ?? 150),
    face_match_threshold: String(s.face_match_threshold ?? 0.85),
    max_devices_per_employee: String(s.max_devices_per_employee ?? 2),
    absence_penalty_enabled: s.absence_penalty_enabled !== false,
  };
}

export function AttendanceRulesTab() {
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
      // Merge with existing settings so we don't wipe working_days etc.
      const existing =
        (companyQ.data?.settings ?? {}) as Record<string, unknown>;
      const settings = {
        ...existing,
        late_threshold_min: Number(f.late_threshold_min),
        late_penalty_per_min: Number(f.late_penalty_per_min),
        overtime_after_hours: Number(f.overtime_after_hours),
        geofence_radius_m: Number(f.geofence_radius_m),
        face_match_threshold: Number(f.face_match_threshold),
        max_devices_per_employee: Number(f.max_devices_per_employee),
        absence_penalty_enabled: f.absence_penalty_enabled,
      };
      return (await api.patch<Company>("/companies/me", { settings })).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["company"] });
      toast.success(t("settings_page.saved"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  if (!form) {
    return <p className="text-sm text-slate-500">{t("common.loading")}</p>;
  }

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (form) saveMut.mutate(form);
      }}
    >
      <Section
        title={t("settings_page.section_attendance")}
        hint={t("settings_page.section_attendance_hint")}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            type="number"
            min={0}
            label={t("settings_page.late_threshold_min")}
            hint={t("settings_page.late_threshold_hint") ?? undefined}
            value={form.late_threshold_min}
            onChange={(e) => update("late_threshold_min", e.target.value)}
          />
          <Input
            type="number"
            min={0}
            step="100"
            label={t("settings_page.late_penalty_per_min")}
            hint={t("settings_page.late_penalty_hint") ?? undefined}
            value={form.late_penalty_per_min}
            onChange={(e) => update("late_penalty_per_min", e.target.value)}
          />
          <Input
            type="number"
            min={0}
            step="0.5"
            label={t("settings_page.overtime_after_hours")}
            hint={t("settings_page.overtime_hint") ?? undefined}
            value={form.overtime_after_hours}
            onChange={(e) => update("overtime_after_hours", e.target.value)}
          />
        </div>
        <label className="flex items-start gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="mt-0.5 size-4"
            checked={form.absence_penalty_enabled}
            onChange={(e) => update("absence_penalty_enabled", e.target.checked)}
          />
          <span>
            <span className="font-semibold">
              {t("settings_page.absence_penalty_label")}
            </span>
            <span className="ml-2 text-[11px] text-slate-500">
              {t("settings_page.absence_penalty_hint")}
            </span>
          </span>
        </label>
      </Section>

      <Section
        title={t("settings_page.section_face_id")}
        hint={t("settings_page.section_face_id_hint")}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            type="number"
            step="0.01"
            min={0}
            max={1}
            label={t("settings_page.face_match_threshold")}
            hint={t("settings_page.face_match_hint") ?? undefined}
            value={form.face_match_threshold}
            onChange={(e) => update("face_match_threshold", e.target.value)}
          />
          <Input
            type="number"
            min={1}
            max={5}
            label={t("settings_page.max_devices_per_employee")}
            hint={t("settings_page.max_devices_hint") ?? undefined}
            value={form.max_devices_per_employee}
            onChange={(e) =>
              update("max_devices_per_employee", e.target.value)
            }
          />
        </div>
      </Section>

      <Section
        title={t("settings_page.section_geofence")}
        hint={t("settings_page.section_geofence_hint")}
      >
        <Input
          type="number"
          min={0}
          step="10"
          label={t("settings_page.geofence_radius_m")}
          hint={t("settings_page.geofence_radius_hint") ?? undefined}
          value={form.geofence_radius_m}
          onChange={(e) => update("geofence_radius_m", e.target.value)}
        />
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
