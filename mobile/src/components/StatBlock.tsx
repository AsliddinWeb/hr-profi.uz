import { Text, View } from "react-native";

interface Props {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "success" | "warning" | "info";
}

const toneClass: Record<NonNullable<Props["tone"]>, { box: string; value: string }> = {
  default: { box: "bg-slate-50", value: "text-slate-900" },
  success: { box: "bg-emerald-50", value: "text-emerald-700" },
  warning: { box: "bg-amber-50", value: "text-amber-700" },
  info: { box: "bg-brand-50", value: "text-brand-700" },
};

export function StatBlock({ label, value, hint, tone = "default" }: Props) {
  const t = toneClass[tone];
  return (
    <View className={`flex-1 rounded-2xl p-4 ${t.box}`}>
      <Text className="mb-1 text-xs uppercase tracking-wide text-slate-500">{label}</Text>
      <Text className={`text-2xl font-bold ${t.value}`}>{value}</Text>
      {hint ? <Text className="mt-1 text-xs text-slate-500">{hint}</Text> : null}
    </View>
  );
}
