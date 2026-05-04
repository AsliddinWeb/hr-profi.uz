import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CalendarClock, CalendarDays } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/cn";
import { SchedulePanel } from "./SchedulePanel";
import { TemplatesPanel } from "./TemplatesPanel";

type Tab = "schedule" | "templates";

export function ShiftsHubPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) === "templates" ? "templates" : "schedule";

  const setTab = (next: Tab) => {
    const newParams = new URLSearchParams(params);
    newParams.set("tab", next);
    setParams(newParams, { replace: true });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("shifts_page.title")}
        breadcrumbs={[{ label: t("shifts_page.title") }]}
        icon={<CalendarDays className="size-5" />}
        description={t("shifts_page.hub_subtitle")}
      />

      <div className="flex border-b border-slate-200">
        <TabButton
          active={tab === "schedule"}
          onClick={() => setTab("schedule")}
          icon={<CalendarDays className="size-4" />}
          label={t("shifts_page.tab_schedule")}
        />
        <TabButton
          active={tab === "templates"}
          onClick={() => setTab("templates")}
          icon={<CalendarClock className="size-4" />}
          label={t("shifts_page.tab_templates")}
        />
      </div>

      {tab === "schedule" ? <SchedulePanel /> : <TemplatesPanel />}
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
