import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  BarChart3,
  Database,
  LayoutGrid,
  ListChecks,
  Trophy,
  Users,
} from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/cn";

import { AssignmentsTab } from "./AssignmentsTab";
import { BulkAssignTab } from "./BulkAssignTab";
import { DashboardTab } from "./DashboardTab";
import { DatapointsTab } from "./DatapointsTab";
import { LeaderboardTab } from "./LeaderboardTab";
import { TemplatesTab } from "./TemplatesTab";

type Tab =
  | "dashboard"
  | "assignments"
  | "templates"
  | "bulk"
  | "datapoints"
  | "leaderboard";

const TABS: Tab[] = [
  "dashboard",
  "assignments",
  "templates",
  "bulk",
  "datapoints",
  "leaderboard",
];

export function KpiHubPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab") as Tab | null;
  const tab: Tab = raw && TABS.includes(raw) ? raw : "dashboard";

  const setTab = (next: Tab) => {
    const p = new URLSearchParams(params);
    p.set("tab", next);
    setParams(p, { replace: true });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("kpi_page.title")}
        breadcrumbs={[{ label: t("kpi_page.title") }]}
        icon={<Trophy className="size-5" />}
        description={t("kpi_page.subtitle")}
      />

      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        <TabButton
          active={tab === "dashboard"}
          onClick={() => setTab("dashboard")}
          icon={<LayoutGrid className="size-4" />}
          label={t("kpi_page.tab_dashboard")}
        />
        <TabButton
          active={tab === "assignments"}
          onClick={() => setTab("assignments")}
          icon={<ListChecks className="size-4" />}
          label={t("kpi_page.tab_assignments")}
        />
        <TabButton
          active={tab === "templates"}
          onClick={() => setTab("templates")}
          icon={<Database className="size-4" />}
          label={t("kpi_page.tab_templates")}
        />
        <TabButton
          active={tab === "bulk"}
          onClick={() => setTab("bulk")}
          icon={<Users className="size-4" />}
          label={t("kpi_page.tab_bulk")}
        />
        <TabButton
          active={tab === "datapoints"}
          onClick={() => setTab("datapoints")}
          icon={<Database className="size-4" />}
          label={t("kpi_page.tab_datapoints")}
        />
        <TabButton
          active={tab === "leaderboard"}
          onClick={() => setTab("leaderboard")}
          icon={<BarChart3 className="size-4" />}
          label={t("kpi_page.tab_leaderboard")}
        />
      </div>

      {tab === "dashboard" && <DashboardTab />}
      {tab === "assignments" && <AssignmentsTab />}
      {tab === "templates" && <TemplatesTab />}
      {tab === "bulk" && <BulkAssignTab />}
      {tab === "datapoints" && <DatapointsTab />}
      {tab === "leaderboard" && <LeaderboardTab />}
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
