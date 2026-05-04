import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  CalendarDays,
  Coins,
  Info,
  Layers,
  ListChecks,
  Plus,
} from "lucide-react";

import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/cn";
import { RequestsTab } from "./RequestsTab";
import { TypesTab } from "./TypesTab";
import { BalancesTab } from "./BalancesTab";

type Tab = "requests" | "types" | "balances";

export function LeavesHubPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab: Tab = raw === "types" || raw === "balances" ? raw : "requests";

  const setTab = (next: Tab) => {
    const p = new URLSearchParams(params);
    p.set("tab", next);
    setParams(p, { replace: true });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("leaves.title")}
        breadcrumbs={[{ label: t("leaves.title") }]}
        icon={<CalendarDays className="size-5" />}
        description={t("leaves.hub_subtitle")}
        actions={
          <Button onClick={() => nav("/app/leaves/new")}>
            <Plus className="size-4" />
            {t("leaves.create_admin_short")}
          </Button>
        }
      />

      <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
        <Coins className="mt-0.5 size-4 shrink-0" />
        <p>{t("leaves.salary_link_info")}</p>
      </div>

      <div className="flex border-b border-slate-200">
        <TabButton
          active={tab === "requests"}
          onClick={() => setTab("requests")}
          icon={<ListChecks className="size-4" />}
          label={t("leaves.tab_requests")}
        />
        <TabButton
          active={tab === "types"}
          onClick={() => setTab("types")}
          icon={<Layers className="size-4" />}
          label={t("leaves.tab_types")}
        />
        <TabButton
          active={tab === "balances"}
          onClick={() => setTab("balances")}
          icon={<Info className="size-4" />}
          label={t("leaves.tab_balances")}
        />
      </div>

      {tab === "requests" && <RequestsTab />}
      {tab === "types" && <TypesTab />}
      {tab === "balances" && <BalancesTab />}

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
