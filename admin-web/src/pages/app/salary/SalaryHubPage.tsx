import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Coins, CreditCard, ListChecks } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/cn";
import { PeriodsTab } from "./PeriodsTab";
import { TransactionsTab } from "./TransactionsTab";

type Tab = "periods" | "transactions";

export function SalaryHubPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab: Tab = raw === "transactions" ? "transactions" : "periods";

  const setTab = (next: Tab) => {
    const p = new URLSearchParams(params);
    p.set("tab", next);
    setParams(p, { replace: true });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("salary_page.title")}
        breadcrumbs={[{ label: t("salary_page.title") }]}
        icon={<Coins className="size-5" />}
        description={t("salary_page.hub_subtitle")}
      />

      <div className="flex border-b border-slate-200">
        <TabButton
          active={tab === "periods"}
          icon={<ListChecks className="size-4" />}
          label={t("salary_page.tab_periods")}
          onClick={() => setTab("periods")}
        />
        <TabButton
          active={tab === "transactions"}
          icon={<CreditCard className="size-4" />}
          label={t("salary_page.tab_transactions")}
          onClick={() => setTab("transactions")}
        />
      </div>

      {tab === "periods" ? <PeriodsTab /> : <TransactionsTab />}
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
