import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ScrollView, Text, View } from "react-native";

import { api } from "@/api/client";
import { Card } from "@/components/Card";
import { StatBlock } from "@/components/StatBlock";
import { formatMoney } from "@/lib/format";
import type { SalaryPeriod, SalaryTodaySnapshot } from "@/lib/types";

const MONTH_NAMES_UZ = [
  "Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun",
  "Iyul", "Avgust", "Sentyabr", "Oktyabr", "Noyabr", "Dekabr",
];
const MONTH_NAMES_RU = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];
const MONTH_NAMES_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function monthLabel(lang: string, m: number): string {
  const idx = Math.max(0, Math.min(11, m - 1));
  if (lang.startsWith("ru")) return MONTH_NAMES_RU[idx];
  if (lang.startsWith("en")) return MONTH_NAMES_EN[idx];
  return MONTH_NAMES_UZ[idx];
}

export default function SalaryScreen() {
  const { t, i18n } = useTranslation();
  const currency = t("common.currency_uzs");

  const today = useQuery({
    queryKey: ["salary", "today"],
    queryFn: async () => (await api.get<SalaryTodaySnapshot>("/salary/me/today")).data,
    refetchInterval: 60_000,
  });

  const history = useQuery({
    queryKey: ["salary", "history"],
    queryFn: async () => (await api.get<SalaryPeriod[]>("/salary/me/history")).data,
  });

  const todayAccrual = today.data?.today;
  const period = today.data?.period;

  return (
    <ScrollView className="flex-1 bg-slate-50" contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      {/* Today breakdown */}
      <Text className="mb-3 text-base font-semibold">{t("salary.today_breakdown")}</Text>
      <Card className="mb-4">
        <Row label={t("salary.base")} value={formatMoney(todayAccrual?.base_earned ?? "0", currency)} />
        <Row label={t("salary.overtime")} value={formatMoney(todayAccrual?.overtime_earned ?? "0", currency)} />
        <Row label={t("salary.bonuses")} value={formatMoney(todayAccrual?.bonuses_earned ?? "0", currency)} />
        <Row label={t("salary.kpi")} value={formatMoney(todayAccrual?.kpi_earned ?? "0", currency)} />
        <Row label={t("salary.deductions")} value={`- ${formatMoney(todayAccrual?.deductions ?? "0", currency)}`} />
        <View className="mt-2 border-t border-slate-200 pt-3">
          <Row
            label={t("salary.total")}
            value={formatMoney(todayAccrual?.total_earned ?? "0", currency)}
            bold
          />
        </View>
      </Card>

      {/* Current month */}
      <Text className="mb-3 text-base font-semibold">{t("salary.current_period")}</Text>
      <Card className="mb-4">
        {period ? (
          <>
            <Text className="mb-2 text-lg font-semibold">
              {monthLabel(i18n.language, period.month)} {period.year}
            </Text>
            <View className="flex-row gap-2">
              <StatBlock
                label={t("salary.total")}
                value={formatMoney(period.total_earned, currency)}
                tone="success"
              />
            </View>
            <View className="mt-2 flex-row gap-2">
              <StatBlock
                label={t("salary.pending")}
                value={formatMoney(today.data?.pending_amount ?? "0", currency)}
                tone="info"
              />
            </View>
          </>
        ) : (
          <Text className="text-slate-500">{t("common.no_data")}</Text>
        )}
      </Card>

      {/* History */}
      <Text className="mb-3 text-base font-semibold">{t("salary.history")}</Text>
      {(history.data ?? []).length === 0 ? (
        <Card>
          <Text className="text-slate-500">{t("common.no_data")}</Text>
        </Card>
      ) : (
        history.data?.map((p) => (
          <Card key={p.id} className="mb-3">
            <View className="flex-row items-center justify-between">
              <Text className="font-semibold">
                {monthLabel(i18n.language, p.month)} {p.year}
              </Text>
              <Text className="text-base font-bold text-emerald-700">
                {formatMoney(p.total_earned, currency)}
              </Text>
            </View>
            <Text className="mt-1 text-xs text-slate-500">
              {p.status} · {t("salary.paid")}: {formatMoney(p.paid_amount, currency)}
            </Text>
          </Card>
        ))
      )}
    </ScrollView>
  );
}

function Row({
  label,
  value,
  bold = false,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <View className="flex-row items-center justify-between py-1">
      <Text className={`text-slate-600 ${bold ? "font-semibold text-slate-900" : ""}`}>
        {label}
      </Text>
      <Text className={`tabular-nums ${bold ? "text-base font-bold" : ""}`}>{value}</Text>
    </View>
  );
}
