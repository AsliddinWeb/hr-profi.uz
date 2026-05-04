import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Activity, CalendarRange, ClipboardCheck, Info, ListChecks, Plus } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/cn";
import { LiveTab } from "./LiveTab";
import { RecordsTab } from "./RecordsTab";
import { MonthlyTab } from "./MonthlyTab";
import { ManualEntryDialog } from "./ManualEntryDialog";

type Tab = "live" | "records" | "monthly";

export function AttendanceHubPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab: Tab = raw === "records" || raw === "monthly" ? raw : "live";
  const [manualOpen, setManualOpen] = useState(false);

  const setTab = (next: Tab) => {
    const p = new URLSearchParams(params);
    p.set("tab", next);
    setParams(p, { replace: true });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("attendance.title")}
        breadcrumbs={[{ label: t("attendance.title") }]}
        icon={<ClipboardCheck className="size-5" />}
        description={t("attendance.hub_subtitle")}
        actions={
          <Button onClick={() => setManualOpen(true)}>
            <Plus className="size-4" />
            {t("attendance.manual")}
          </Button>
        }
      />

      <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        <Info className="mt-0.5 size-4 shrink-0 text-slate-400" />
        <p>{t("attendance.rest_day_info")}</p>
      </div>

      <div className="flex border-b border-slate-200">
        <TabButton
          active={tab === "live"}
          onClick={() => setTab("live")}
          icon={<Activity className="size-4" />}
          label={t("attendance.tab_live")}
        />
        <TabButton
          active={tab === "records"}
          onClick={() => setTab("records")}
          icon={<ListChecks className="size-4" />}
          label={t("attendance.tab_records")}
        />
        <TabButton
          active={tab === "monthly"}
          onClick={() => setTab("monthly")}
          icon={<CalendarRange className="size-4" />}
          label={t("attendance.tab_monthly")}
        />
      </div>

      {tab === "live" && <LiveTab />}
      {tab === "records" && <RecordsTab />}
      {tab === "monthly" && <MonthlyTab />}

      <ManualEntryDialog open={manualOpen} onClose={() => setManualOpen(false)} />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition",
        active
          ? "border-brand-500 text-brand-700"
          : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
      )}
    >
      {icon}
      {label}
    </button>
  );
}
