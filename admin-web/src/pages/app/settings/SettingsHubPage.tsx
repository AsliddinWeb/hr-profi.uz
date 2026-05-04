import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Bell,
  Building2,
  CalendarRange,
  Clock,
  Settings as SettingsIcon,
  Shield,
  User,
} from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/cn";

import { AttendanceRulesTab } from "./AttendanceRulesTab";
import { CompanyTab } from "./CompanyTab";
import { NotificationsTab } from "./NotificationsTab";
import { ProfileTab } from "./ProfileTab";
import { SecurityTab } from "./SecurityTab";
import { WorkScheduleTab } from "./WorkScheduleTab";

type Tab =
  | "company"
  | "attendance"
  | "schedule"
  | "profile"
  | "notifications"
  | "security";

const TABS: Tab[] = [
  "company",
  "attendance",
  "schedule",
  "profile",
  "notifications",
  "security",
];

export function SettingsHubPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab") as Tab | null;
  const tab: Tab = raw && TABS.includes(raw) ? raw : "company";

  const setTab = (next: Tab) => {
    const p = new URLSearchParams(params);
    p.set("tab", next);
    setParams(p, { replace: true });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("settings_page.title")}
        breadcrumbs={[{ label: t("settings_page.title") }]}
        icon={<SettingsIcon className="size-5" />}
        description={t("settings_page.subtitle")}
      />

      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        <TabButton
          active={tab === "company"}
          onClick={() => setTab("company")}
          icon={<Building2 className="size-4" />}
          label={t("settings_page.tab_company")}
        />
        <TabButton
          active={tab === "attendance"}
          onClick={() => setTab("attendance")}
          icon={<Clock className="size-4" />}
          label={t("settings_page.tab_attendance")}
        />
        <TabButton
          active={tab === "schedule"}
          onClick={() => setTab("schedule")}
          icon={<CalendarRange className="size-4" />}
          label={t("settings_page.tab_schedule")}
        />
        <TabButton
          active={tab === "profile"}
          onClick={() => setTab("profile")}
          icon={<User className="size-4" />}
          label={t("settings_page.tab_profile")}
        />
        <TabButton
          active={tab === "notifications"}
          onClick={() => setTab("notifications")}
          icon={<Bell className="size-4" />}
          label={t("settings_page.tab_notifications")}
        />
        <TabButton
          active={tab === "security"}
          onClick={() => setTab("security")}
          icon={<Shield className="size-4" />}
          label={t("settings_page.tab_security")}
        />
      </div>

      {tab === "company" && <CompanyTab />}
      {tab === "attendance" && <AttendanceRulesTab />}
      {tab === "schedule" && <WorkScheduleTab />}
      {tab === "profile" && <ProfileTab />}
      {tab === "notifications" && <NotificationsTab />}
      {tab === "security" && <SecurityTab />}
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
