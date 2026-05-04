import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ScrollView, Text, View } from "react-native";

import { api } from "@/api/client";
import { Card } from "@/components/Card";
import { formatDateShort } from "@/lib/format";
import type { ShiftSchedule } from "@/lib/types";

export default function ShiftsScreen() {
  const { t } = useTranslation();
  const today = new Date().toISOString().slice(0, 10);

  const { data, isLoading } = useQuery({
    queryKey: ["shifts", "me", "upcoming", today],
    queryFn: async () =>
      (await api.get<ShiftSchedule[]>("/shifts/me", { params: { from: today } })).data,
  });

  return (
    <ScrollView
      className="flex-1 bg-slate-50"
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
    >
      <Text className="mb-3 text-base font-semibold">{t("shifts.upcoming")}</Text>
      {isLoading ? (
        <Card>
          <Text className="text-slate-500">{t("common.loading")}</Text>
        </Card>
      ) : (data ?? []).length === 0 ? (
        <Card>
          <Text className="text-slate-500">{t("shifts.no_upcoming")}</Text>
        </Card>
      ) : (
        data!.map((s) => (
          <Card key={s.id} className="mb-3">
            <View className="flex-row items-center justify-between">
              <Text className="font-semibold">{formatDateShort(s.date)}</Text>
              <Text className="text-xs text-slate-500">{s.status}</Text>
            </View>
            <Text className="mt-1 text-slate-600">
              {s.custom_start ?? "—"} → {s.custom_end ?? "—"}
            </Text>
          </Card>
        ))
      )}
    </ScrollView>
  );
}
