import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  AlertTriangle,
  Bell,
  CalendarDays,
  Clock,
  Coins,
  Cpu,
  Save,
  Trophy,
} from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { useEnumLabel } from "@/lib/enum";
import type {
  NotificationCategory,
  NotificationPreferences,
} from "@/lib/types";

import { Section } from "./components";

const ROWS: {
  category: NotificationCategory;
  icon: React.ComponentType<{ className?: string }>;
  hintKey: string;
}[] = [
  { category: "ATTENDANCE", icon: Clock, hintKey: "settings_page.notif_attendance_hint" },
  { category: "SALARY", icon: Coins, hintKey: "settings_page.notif_salary_hint" },
  { category: "KPI", icon: Trophy, hintKey: "settings_page.notif_kpi_hint" },
  { category: "LEAVE", icon: CalendarDays, hintKey: "settings_page.notif_leave_hint" },
  { category: "DEVICE", icon: Cpu, hintKey: "settings_page.notif_device_hint" },
  { category: "ANOMALY", icon: AlertTriangle, hintKey: "settings_page.notif_anomaly_hint" },
];

export function NotificationsTab() {
  const { t } = useTranslation();
  const label = useEnumLabel();
  const qc = useQueryClient();

  const prefsQ = useQuery({
    queryKey: ["notifications", "preferences"],
    queryFn: async () =>
      (await api.get<NotificationPreferences>("/notifications/preferences")).data,
  });

  const [enabled, setEnabled] = useState<Map<NotificationCategory, boolean>>(
    new Map()
  );
  useEffect(() => {
    if (prefsQ.data) {
      const m = new Map<NotificationCategory, boolean>();
      for (const it of prefsQ.data.items) m.set(it.category, it.enabled);
      setEnabled(m);
    }
  }, [prefsQ.data]);

  const saveMut = useMutation({
    mutationFn: async () =>
      (
        await api.put<NotificationPreferences>("/notifications/preferences", {
          items: ROWS.map((r) => ({
            category: r.category,
            enabled: enabled.get(r.category) ?? true,
          })),
        })
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications", "preferences"] });
      toast.success(t("settings_page.saved"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const toggle = (cat: NotificationCategory) => {
    setEnabled((m) => {
      const n = new Map(m);
      n.set(cat, !(m.get(cat) ?? true));
      return n;
    });
  };

  if (prefsQ.isLoading) {
    return <p className="text-sm text-slate-500">{t("common.loading")}</p>;
  }

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        saveMut.mutate();
      }}
    >
      <Section
        title={t("settings_page.section_notifications")}
        hint={t("settings_page.section_notifications_hint")}
      >
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
          <Bell className="mr-1 inline size-3.5 text-slate-500" />
          {t("settings_page.system_always_hint")}
        </div>

        <ul className="divide-y divide-slate-200">
          {ROWS.map((r) => {
            const Icon = r.icon;
            const on = enabled.get(r.category) ?? true;
            return (
              <li
                key={r.category}
                className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
              >
                <span
                  className={`flex size-9 shrink-0 items-center justify-center rounded-full ring-1 ${
                    on
                      ? "bg-brand-50 text-brand-700 ring-brand-200"
                      : "bg-slate-50 text-slate-400 ring-slate-200"
                  }`}
                >
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-slate-800">
                    {label("notification_category", r.category)}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {t(r.hintKey)}
                  </div>
                </div>
                {/* Toggle switch */}
                <button
                  type="button"
                  onClick={() => toggle(r.category)}
                  role="switch"
                  aria-checked={on}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
                    on ? "bg-brand-600" : "bg-slate-300"
                  }`}
                >
                  <span
                    className={`inline-block size-5 transform rounded-full bg-white shadow transition ${
                      on ? "translate-x-5" : "translate-x-1"
                    }`}
                  />
                </button>
              </li>
            );
          })}
        </ul>
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
