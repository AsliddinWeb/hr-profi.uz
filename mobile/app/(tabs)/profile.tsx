import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { api } from "@/api/client";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { formatDateShort } from "@/lib/format";
import type { Employee } from "@/lib/types";
import { useAuthStore } from "@/stores/auth";

const LANGS = [
  { code: "uz", label: "O'zbekcha" },
  { code: "ru", label: "Русский" },
  { code: "en", label: "English" },
] as const;

export default function ProfileScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const { data: emp } = useQuery({
    queryKey: ["employee", "me"],
    queryFn: async () => (await api.get<Employee>("/employees/me")).data,
  });

  const onLogout = () => {
    logout();
    router.replace("/(auth)/login");
  };

  return (
    <ScrollView
      className="flex-1 bg-slate-50"
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
    >
      <Card className="mb-4 items-center">
        <View className="mb-3 size-20 items-center justify-center rounded-full bg-brand-100">
          <Text className="text-2xl font-bold text-brand-700">
            {(emp?.full_name || user?.username || "?").slice(0, 2).toUpperCase()}
          </Text>
        </View>
        <Text className="text-lg font-semibold">{emp?.full_name ?? user?.full_name ?? user?.username}</Text>
        <Text className="text-sm text-slate-500">{user?.role}</Text>
      </Card>

      <Card className="mb-4">
        <Text className="mb-3 text-sm font-semibold text-slate-700">{t("profile.info")}</Text>
        <Row label={t("profile.code")} value={emp?.employee_code ?? "—"} />
        <Row label={t("profile.position")} value={emp?.position ?? "—"} />
        <Row label={t("profile.phone")} value={emp?.phone ?? user?.phone ?? "—"} />
        <Row label={t("profile.email")} value={emp?.email ?? user?.email ?? "—"} />
        <Row label="Hire date" value={formatDateShort(emp?.hire_date)} />
      </Card>

      <Card className="mb-4">
        <Text className="mb-3 text-sm font-semibold text-slate-700">{t("common.language")}</Text>
        <View className="flex-row gap-2">
          {LANGS.map((l) => (
            <Pressable
              key={l.code}
              onPress={() => void i18n.changeLanguage(l.code)}
              className={`flex-1 rounded-xl px-3 py-3 ${
                i18n.language === l.code ? "bg-brand-600" : "bg-slate-100"
              }`}
            >
              <Text
                className={`text-center font-medium ${
                  i18n.language === l.code ? "text-white" : "text-slate-700"
                }`}
              >
                {l.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </Card>

      <Button variant="danger" onPress={onLogout}>
        {t("auth.logout")}
      </Button>
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between border-b border-slate-100 py-2 last:border-b-0">
      <Text className="text-slate-500">{label}</Text>
      <Text className="font-medium">{value}</Text>
    </View>
  );
}
