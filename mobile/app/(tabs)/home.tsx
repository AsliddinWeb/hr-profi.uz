import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useTranslation } from "react-i18next";
import {
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";

import { api, apiErrorMessage } from "@/api/client";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { StatBlock } from "@/components/StatBlock";
import { useLocation } from "@/hooks/useLocation";
import {
  formatHoursFromMinutes,
  formatMoney,
  formatTime,
} from "@/lib/format";
import type {
  AttendanceRecord,
  Employee,
  SalaryTodaySnapshot,
  ShiftSchedule,
  TodayStatus,
} from "@/lib/types";

export default function HomeScreen() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const location = useLocation();

  const { data: emp } = useQuery({
    queryKey: ["employee", "me"],
    queryFn: async () => (await api.get<Employee>("/employees/me")).data,
  });

  const today = useQuery({
    queryKey: ["attendance", "today"],
    queryFn: async () => (await api.get<TodayStatus>("/attendance/today")).data,
    refetchInterval: 60_000,
  });

  const salary = useQuery({
    queryKey: ["salary", "today"],
    queryFn: async () => (await api.get<SalaryTodaySnapshot>("/salary/me/today")).data,
    refetchInterval: 60_000,
  });

  // Today's planned shift (used to display the start/end). We hit the bulk
  // endpoint with from=today, to=today which is cheap.
  const todayIso = new Date().toISOString().slice(0, 10);
  const shift = useQuery({
    queryKey: ["shifts", "today", todayIso],
    queryFn: async () =>
      (
        await api.get<ShiftSchedule[]>("/shifts/me", {
          params: { from: todayIso, to: todayIso },
        })
      ).data,
  });

  const checkInMut = useMutation({
    mutationFn: async () => {
      const pos = await location.getOnce();
      const payload = pos
        ? {
            latitude: pos.latitude,
            longitude: pos.longitude,
            accuracy_m: pos.accuracy ?? undefined,
          }
        : {};
      const url = today.data?.is_working ? "/attendance/check-out" : "/attendance/check-in";
      return (await api.post<AttendanceRecord>(url, payload)).data;
    },
    onMutate: () => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    },
    onSuccess: () => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      qc.invalidateQueries({ queryKey: ["attendance"] });
      qc.invalidateQueries({ queryKey: ["salary"] });
    },
    onError: () => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    },
  });

  const isWorking = today.data?.is_working ?? false;

  return (
    <ScrollView
      className="flex-1 bg-slate-50"
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      refreshControl={
        <RefreshControl
          refreshing={today.isRefetching || salary.isRefetching}
          onRefresh={() => {
            today.refetch();
            salary.refetch();
            shift.refetch();
          }}
        />
      }
    >
      {/* Greeting */}
      <View className="mb-4">
        <Text className="text-lg text-slate-500">{t("common.today")}</Text>
        <Text className="text-2xl font-bold tracking-tight">
          {emp?.full_name ?? "—"}
        </Text>
      </View>

      {/* Today's shift */}
      <Card className="mb-4">
        <Text className="mb-2 text-xs uppercase tracking-wide text-slate-500">
          {t("home.shift_today")}
        </Text>
        {shift.data && shift.data.length > 0 ? (
          <Text className="text-base font-medium">
            {shift.data[0].custom_start ?? "—"} → {shift.data[0].custom_end ?? "—"}{" "}
            <Text className="text-slate-500">({shift.data[0].status})</Text>
          </Text>
        ) : (
          <Text className="text-slate-500">{t("home.no_shift_today")}</Text>
        )}
        {today.data?.first_check_in ? (
          <Text className="mt-2 text-xs text-slate-500">
            CHECK-IN: {formatTime(today.data.first_check_in)} ·{" "}
            {today.data.last_check_out ? `OUT: ${formatTime(today.data.last_check_out)}` : ""}
          </Text>
        ) : null}
      </Card>

      {/* Big check-in/out button */}
      <Button
        size="lg"
        variant={isWorking ? "danger" : "success"}
        loading={checkInMut.isPending}
        onPress={() => checkInMut.mutate()}
      >
        {checkInMut.isPending
          ? t("home.checking_in")
          : isWorking
            ? t("home.check_out")
            : t("home.check_in")}
      </Button>
      {checkInMut.isError ? (
        <Text className="mt-2 text-center text-sm text-red-600">
          {apiErrorMessage(checkInMut.error, t("common.error"))}
        </Text>
      ) : null}
      {location.status === "denied" ? (
        <Text className="mt-2 text-center text-xs text-amber-700">
          {t("home.location_denied")}
        </Text>
      ) : null}

      {/* Stats */}
      <View className="mt-6 flex-row gap-3">
        <StatBlock
          label={t("home.worked_today")}
          value={formatHoursFromMinutes(today.data?.minutes_worked_today ?? 0)}
          tone={isWorking ? "info" : "default"}
          hint={isWorking ? t("home.you_are_working") : t("home.not_working")}
        />
      </View>

      <View className="mt-3 flex-row gap-3">
        <StatBlock
          label={t("home.earned_today")}
          value={formatMoney(salary.data?.today?.total_earned ?? "0", t("common.currency_uzs"))}
          tone="success"
        />
      </View>
      <View className="mt-3 flex-row gap-3">
        <StatBlock
          label={t("home.earned_month")}
          value={formatMoney(salary.data?.period?.total_earned ?? "0", t("common.currency_uzs"))}
          tone="info"
          hint={
            salary.data?.pending_amount
              ? `${t("salary.pending")}: ${formatMoney(salary.data.pending_amount, t("common.currency_uzs"))}`
              : undefined
          }
        />
      </View>
    </ScrollView>
  );
}
