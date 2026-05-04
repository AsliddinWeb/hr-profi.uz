import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { api, apiErrorMessage } from "@/api/client";
import { Button } from "@/components/Button";
import { useAuthStore } from "@/stores/auth";
import type { TokenPair, User } from "@/lib/types";

const LANGS = [
  { code: "uz", label: "UZ" },
  { code: "ru", label: "RU" },
  { code: "en", label: "EN" },
] as const;

export default function LoginScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const setTokens = useAuthStore((s) => s.setTokens);
  const setUser = useAuthStore((s) => s.setUser);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const mutation = useMutation({
    mutationFn: async (creds: { username: string; password: string }) => {
      const { data } = await api.post<TokenPair>("/auth/login", creds);
      setTokens(data);
      const me = await api.get<User>("/auth/me");
      setUser(me.data);
      return me.data;
    },
    onSuccess: () => {
      router.replace("/(tabs)/home");
    },
  });

  return (
    <SafeAreaView className="flex-1 bg-slate-50">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}
          keyboardShouldPersistTaps="handled"
        >
          <View className="px-6">
            <View className="mb-2 flex-row justify-end">
              {LANGS.map((l) => (
                <Pressable
                  key={l.code}
                  onPress={() => void i18n.changeLanguage(l.code)}
                  className={`ml-2 rounded-full px-3 py-1 ${
                    i18n.language === l.code ? "bg-brand-600" : "bg-slate-200"
                  }`}
                >
                  <Text
                    className={`text-xs font-medium ${
                      i18n.language === l.code ? "text-white" : "text-slate-700"
                    }`}
                  >
                    {l.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View className="mb-8 mt-4 items-center">
              <View className="size-16 items-center justify-center rounded-2xl bg-brand-600">
                <Text className="text-2xl font-bold text-white">W</Text>
              </View>
              <Text className="mt-3 text-2xl font-bold tracking-tight">{t("app.name")}</Text>
            </View>

            <Text className="mb-1 text-2xl font-semibold">{t("auth.sign_in")}</Text>
            <Text className="mb-6 text-sm text-slate-500">
              {t("auth.username")} + {t("auth.password")}
            </Text>

            <Text className="mb-1.5 text-sm font-medium text-slate-700">
              {t("auth.username")}
            </Text>
            <TextInput
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              className="mb-4 h-12 rounded-xl border border-slate-200 bg-white px-4 text-base"
              placeholder=""
            />

            <Text className="mb-1.5 text-sm font-medium text-slate-700">
              {t("auth.password")}
            </Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="password"
              className="mb-4 h-12 rounded-xl border border-slate-200 bg-white px-4 text-base"
            />

            {mutation.isError ? (
              <Text className="mb-3 text-sm text-red-600">
                {apiErrorMessage(mutation.error, t("common.error"))}
              </Text>
            ) : null}

            <Button
              size="lg"
              loading={mutation.isPending}
              onPress={() => mutation.mutate({ username, password })}
            >
              {mutation.isPending ? t("auth.logging_in") : t("auth.submit")}
            </Button>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
