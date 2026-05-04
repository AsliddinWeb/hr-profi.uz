import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { api } from "@/api/client";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { formatMoney } from "@/lib/format";
import type { KPIAssignmentDetail } from "@/lib/types";

type Mode = "current" | "history";

export default function KpiScreen() {
  const { t, i18n } = useTranslation();
  const currency = t("common.currency_uzs");
  const [mode, setMode] = useState<Mode>("current");
  const [active, setActive] = useState<KPIAssignmentDetail | null>(null);

  const meQ = useQuery({
    queryKey: ["kpi", "me"],
    queryFn: async () =>
      (await api.get<KPIAssignmentDetail[]>("/kpi/me")).data,
  });

  const historyQ = useQuery({
    queryKey: ["kpi", "me", "history"],
    queryFn: async () =>
      (await api.get<KPIAssignmentDetail[]>("/kpi/me/history", {
        params: { months: 12 },
      })).data,
    enabled: mode === "history",
  });

  const items =
    mode === "current"
      ? (meQ.data ?? [])
      : (historyQ.data ?? []).filter((a) => a.status !== "CANCELLED");

  const summary = useMemo(() => {
    let reward = 0;
    let avg = 0;
    for (const a of items) {
      avg += Number(a.score) || 0;
      if (!a.is_penalty) reward += Number(a.computed_reward) || 0;
    }
    return {
      total: items.length,
      avg: items.length ? avg / items.length : 0,
      reward,
    };
  }, [items]);

  const refreshing = meQ.isFetching || historyQ.isFetching;
  const onRefresh = () => {
    if (mode === "current") meQ.refetch();
    else historyQ.refetch();
  };

  return (
    <ScrollView
      className="flex-1 bg-slate-50"
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      {/* Tab pills */}
      <View className="mb-4 flex-row gap-2">
        <ModeTab
          active={mode === "current"}
          onPress={() => setMode("current")}
          label={t("kpi.current")}
        />
        <ModeTab
          active={mode === "history"}
          onPress={() => setMode("history")}
          label={t("kpi.history")}
        />
      </View>

      {/* Summary tiles */}
      {items.length > 0 && (
        <View className="mb-4 flex-row gap-2">
          <SummaryTile
            tone="brand"
            label={t("kpi.summary_count")}
            value={String(summary.total)}
          />
          <SummaryTile
            tone={
              summary.avg >= 100
                ? "emerald"
                : summary.avg >= 80
                  ? "brand"
                  : summary.avg >= 50
                    ? "amber"
                    : "rose"
            }
            label={t("kpi.summary_avg")}
            value={`${summary.avg.toFixed(1)}%`}
          />
          <SummaryTile
            tone="emerald"
            label={t("kpi.summary_total")}
            value={formatMoney(summary.reward, currency)}
          />
        </View>
      )}

      {/* List */}
      {meQ.isLoading || historyQ.isLoading ? (
        <Card>
          <Text className="text-slate-500">{t("common.loading")}</Text>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <Text className="text-slate-500">
            {mode === "current" ? t("kpi.no_kpi") : t("kpi.no_history")}
          </Text>
        </Card>
      ) : (
        items.map((a) => (
          <KpiCard
            key={a.id}
            assignment={a}
            currency={currency}
            locale={i18n.language}
            onPress={() => setActive(a)}
          />
        ))
      )}

      <Modal
        visible={!!active}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setActive(null)}
      >
        {active && (
          <DetailSheet
            assignment={active}
            currency={currency}
            locale={i18n.language}
            onClose={() => setActive(null)}
          />
        )}
      </Modal>
    </ScrollView>
  );
}

function ModeTab({
  active,
  onPress,
  label,
}: {
  active: boolean;
  onPress: () => void;
  label: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`flex-1 items-center rounded-full px-4 py-2 ${
        active ? "bg-brand-600" : "bg-white"
      }`}
    >
      <Text
        className={`text-sm font-semibold ${
          active ? "text-white" : "text-slate-700"
        }`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function SummaryTile({
  tone,
  label,
  value,
}: {
  tone: "brand" | "emerald" | "amber" | "rose";
  label: string;
  value: string;
}) {
  const cls = {
    brand: "bg-brand-50",
    emerald: "bg-emerald-50",
    amber: "bg-amber-50",
    rose: "bg-rose-50",
  }[tone];
  const textCls = {
    brand: "text-brand-800",
    emerald: "text-emerald-800",
    amber: "text-amber-800",
    rose: "text-rose-800",
  }[tone];
  return (
    <View className={`flex-1 rounded-2xl px-3 py-2.5 ${cls}`}>
      <Text className={`text-[10px] uppercase tracking-wide opacity-70 ${textCls}`}>
        {label}
      </Text>
      <Text className={`text-base font-bold ${textCls}`}>{value}</Text>
    </View>
  );
}

function scoreTone(s: number) {
  if (s >= 100)
    return {
      pillBg: "bg-emerald-100",
      pillText: "text-emerald-800",
      bar: "bg-emerald-500",
    };
  if (s >= 80)
    return {
      pillBg: "bg-brand-100",
      pillText: "text-brand-800",
      bar: "bg-brand-500",
    };
  if (s >= 50)
    return {
      pillBg: "bg-amber-100",
      pillText: "text-amber-800",
      bar: "bg-amber-500",
    };
  return {
    pillBg: "bg-rose-100",
    pillText: "text-rose-800",
    bar: "bg-rose-500",
  };
}

const STATUS_BADGE: Record<
  string,
  { bg: string; text: string }
> = {
  DRAFT: { bg: "bg-slate-100", text: "text-slate-700" },
  ACTIVE: { bg: "bg-sky-100", text: "text-sky-800" },
  COMPUTED: { bg: "bg-indigo-100", text: "text-indigo-800" },
  APPROVED: { bg: "bg-emerald-100", text: "text-emerald-800" },
  PAID: { bg: "bg-emerald-200", text: "text-emerald-900" },
  REJECTED: { bg: "bg-rose-100", text: "text-rose-800" },
  CANCELLED: { bg: "bg-slate-100", text: "text-slate-500" },
  COMPLETED: { bg: "bg-emerald-100", text: "text-emerald-800" },
};

function KpiCard({
  assignment,
  currency,
  onPress,
}: {
  assignment: KPIAssignmentDetail;
  currency: string;
  locale: string;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const score = Number(assignment.score) || 0;
  const tone = scoreTone(score);
  const statusTone = STATUS_BADGE[assignment.status];
  const isPenalty = assignment.is_penalty;
  const reward = Number(assignment.computed_reward) || 0;
  const period = `${assignment.year}-${String(assignment.month).padStart(2, "0")}`;

  // Cap visual progress at 100% to keep the bar readable.
  const progressPct = Math.min(100, Math.max(0, score));

  return (
    <Pressable onPress={onPress} className="mb-3">
      <Card>
        {/* Header */}
        <View className="flex-row items-start justify-between">
          <View className="flex-1 pr-3">
            <Text className="text-base font-semibold text-slate-900">
              {assignment.template_name ?? "—"}
            </Text>
            <View className="mt-1 flex-row items-center gap-2">
              <Text className="text-[11px] text-slate-500">{period}</Text>
              {assignment.template_category && (
                <View className="rounded-full bg-slate-100 px-2 py-0.5">
                  <Text className="text-[10px] font-semibold uppercase text-slate-600">
                    {t(`kpi.category.${assignment.template_category}` as never)}
                  </Text>
                </View>
              )}
            </View>
          </View>
          {statusTone && (
            <View className={`rounded-full px-2 py-1 ${statusTone.bg}`}>
              <Text className={`text-[10px] font-bold uppercase ${statusTone.text}`}>
                {t(`kpi.status_label.${assignment.status}` as never)}
              </Text>
            </View>
          )}
        </View>

        {/* Score */}
        <View className="mt-3">
          <View className="flex-row items-center justify-between">
            <Text className="text-xs uppercase tracking-wide text-slate-500">
              {t("kpi.score")}
            </Text>
            <View className={`rounded-full px-3 py-1 ${tone.pillBg}`}>
              <Text className={`text-sm font-bold ${tone.pillText}`}>
                {score.toFixed(1)}%
              </Text>
            </View>
          </View>
          <View className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
            <View
              className={`h-full rounded-full ${tone.bar}`}
              style={{ width: `${progressPct}%` }}
            />
          </View>
        </View>

        {/* Numbers row */}
        <View className="mt-3 flex-row justify-between">
          <View className="flex-1">
            <Text className="text-[10px] uppercase text-slate-500">
              {t("kpi.actual")}
            </Text>
            <Text className="text-sm font-semibold text-slate-800">
              {Number(assignment.actual).toFixed(2)}
              {assignment.template_unit ? ` ${assignment.template_unit}` : ""}
            </Text>
          </View>
          <View className="flex-1">
            <Text className="text-[10px] uppercase text-slate-500">
              {t("kpi.target")}
            </Text>
            <Text className="text-sm font-semibold text-slate-800">
              {Number(assignment.target).toFixed(2)}
            </Text>
          </View>
          <View className="flex-1">
            <Text className="text-[10px] uppercase text-slate-500">
              {isPenalty ? t("kpi.penalty") : t("kpi.reward")}
            </Text>
            <Text
              className={`text-sm font-bold ${
                isPenalty ? "text-rose-700" : "text-emerald-700"
              }`}
            >
              {reward > 0
                ? `${isPenalty ? "−" : "+"}${formatMoney(reward, currency)}`
                : "—"}
            </Text>
          </View>
        </View>

        {/* Manager comment teaser */}
        {assignment.manager_comment && (
          <View className="mt-3 rounded-md bg-amber-50 p-2">
            <Text className="text-[10px] font-semibold uppercase text-amber-700">
              {t("kpi.manager_comment")}
            </Text>
            <Text
              numberOfLines={2}
              className="mt-0.5 text-xs text-amber-900"
            >
              {assignment.manager_comment}
            </Text>
          </View>
        )}
      </Card>
    </Pressable>
  );
}

function DetailSheet({
  assignment,
  currency,
  locale,
  onClose,
}: {
  assignment: KPIAssignmentDetail;
  currency: string;
  locale: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [response, setResponse] = useState(assignment.employee_response ?? "");
  const score = Number(assignment.score) || 0;
  const tone = scoreTone(score);
  const isPenalty = assignment.is_penalty;
  const reward = Number(assignment.computed_reward) || 0;

  const respMut = useMutation({
    mutationFn: async () =>
      api.patch(`/kpi/me/${assignment.id}`, {
        employee_response: response || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kpi"] });
    },
  });

  return (
    <View className="flex-1 bg-slate-50">
      {/* Header */}
      <View className="flex-row items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
        <Text className="flex-1 text-base font-semibold" numberOfLines={1}>
          {assignment.template_name ?? "—"}
        </Text>
        <Pressable
          onPress={onClose}
          className="rounded-full bg-slate-100 px-3 py-1.5 active:bg-slate-200"
        >
          <Text className="text-sm font-semibold text-slate-700">×</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {/* Big score */}
        <View className={`mb-3 items-center rounded-2xl py-6 ${tone.pillBg}`}>
          <Text className={`text-[10px] uppercase ${tone.pillText} opacity-70`}>
            {t("kpi.score")}
          </Text>
          <Text className={`text-5xl font-bold ${tone.pillText}`}>
            {score.toFixed(1)}%
          </Text>
          <Text className="mt-1 text-xs text-slate-600">
            {assignment.year}-{String(assignment.month).padStart(2, "0")}
          </Text>
        </View>

        {/* Stats */}
        <Card className="mb-3">
          <View className="flex-row justify-between">
            <View className="flex-1">
              <Text className="text-[10px] uppercase text-slate-500">
                {t("kpi.actual")}
              </Text>
              <Text className="text-base font-bold text-slate-800">
                {Number(assignment.actual).toFixed(2)}
                {assignment.template_unit ? ` ${assignment.template_unit}` : ""}
              </Text>
            </View>
            <View className="flex-1">
              <Text className="text-[10px] uppercase text-slate-500">
                {t("kpi.target")}
              </Text>
              <Text className="text-base font-bold text-slate-800">
                {Number(assignment.target).toFixed(2)}
              </Text>
            </View>
            <View className="flex-1">
              <Text className="text-[10px] uppercase text-slate-500">
                {t("kpi.weight")}
              </Text>
              <Text className="text-base font-bold text-slate-800">
                {Number(assignment.weight_at_assignment).toFixed(1)}×
              </Text>
            </View>
          </View>
          <View className="mt-3 border-t border-slate-100 pt-3">
            <Text className="text-[10px] uppercase text-slate-500">
              {isPenalty ? t("kpi.penalty") : t("kpi.reward")}
            </Text>
            <Text
              className={`text-2xl font-bold ${
                isPenalty ? "text-rose-700" : "text-emerald-700"
              }`}
            >
              {reward > 0
                ? `${isPenalty ? "−" : "+"}${formatMoney(reward, currency)}`
                : "—"}
            </Text>
          </View>
        </Card>

        {/* Manager review */}
        {(assignment.manager_rating || assignment.manager_comment) && (
          <Card className="mb-3 border border-amber-200 bg-amber-50">
            {assignment.manager_rating && (
              <View className="flex-row items-center gap-1">
                <Text className="text-xs font-semibold uppercase text-amber-800">
                  {t("kpi.manager_rating")}:
                </Text>
                <Text className="text-base font-bold text-amber-900">
                  ★ {Number(assignment.manager_rating).toFixed(1)} / 5
                </Text>
              </View>
            )}
            {assignment.manager_comment && (
              <Text className="mt-2 text-sm text-amber-900">
                {assignment.manager_comment}
              </Text>
            )}
          </Card>
        )}

        {/* Inputs snapshot */}
        {assignment.inputs_snapshot?.vars && (
          <Card className="mb-3">
            <Text className="mb-2 text-xs font-semibold uppercase text-slate-700">
              {t("kpi.inputs_snapshot")}
            </Text>
            <View className="rounded-md bg-slate-50 p-2">
              <Text className="font-mono text-[11px] text-slate-700">
                {assignment.inputs_snapshot.formula}
              </Text>
            </View>
            <View className="mt-2">
              {Object.entries(assignment.inputs_snapshot.vars).map(([k, v]) => (
                <View
                  key={k}
                  className="flex-row items-center justify-between border-b border-slate-100 py-1.5"
                >
                  <Text className="font-mono text-xs text-slate-600">{k}</Text>
                  <Text className="font-mono text-sm font-semibold text-slate-800">
                    {v}
                  </Text>
                </View>
              ))}
            </View>
          </Card>
        )}

        {/* Employee response — editable while not finalized */}
        {assignment.status !== "PAID" &&
          assignment.status !== "REJECTED" &&
          assignment.status !== "CANCELLED" && (
            <Card className="mb-3">
              <Text className="mb-2 text-xs font-semibold uppercase text-slate-700">
                {t("kpi.your_response")}
              </Text>
              <TextInput
                multiline
                numberOfLines={4}
                value={response}
                onChangeText={setResponse}
                placeholder={t("kpi.response_placeholder") ?? ""}
                className="min-h-[80px] rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800"
                textAlignVertical="top"
              />
              <View className="mt-2">
                <Button
                  onPress={() => respMut.mutate()}
                  loading={respMut.isPending}
                >
                  {t("kpi.save_response")}
                </Button>
              </View>
              {respMut.isSuccess && (
                <Text className="mt-2 text-xs text-emerald-700">
                  ✓ {t("kpi.response_saved")}
                </Text>
              )}
            </Card>
          )}

        {assignment.employee_response &&
          (assignment.status === "PAID" ||
            assignment.status === "REJECTED" ||
            assignment.status === "CANCELLED") && (
            <Card className="mb-3 bg-sky-50">
              <Text className="text-[10px] font-semibold uppercase text-sky-700">
                {t("kpi.your_response")}
              </Text>
              <Text className="mt-1 text-sm text-sky-900">
                {assignment.employee_response}
              </Text>
            </Card>
          )}

        {assignment.approved_at && (
          <Text className="mt-2 text-center text-[10px] text-slate-400">
            {t("kpi.approved_at")}:{" "}
            {new Date(assignment.approved_at).toLocaleString(locale)}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}
