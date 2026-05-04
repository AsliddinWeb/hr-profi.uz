import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Slot, useRouter, useSegments } from "expo-router";
import { useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import "@/i18n";
import { api } from "@/api/client";
import { useAuthStore } from "@/stores/auth";
import type { User } from "@/lib/types";
import "../global.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

function AuthGate() {
  const segments = useSegments();
  const router = useRouter();
  const accessToken = useAuthStore((s) => s.accessToken);
  const hydrated = useAuthStore((s) => s.hydrated);
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  useEffect(() => {
    if (!hydrated) return;
    const inAuthGroup = segments[0] === "(auth)";
    if (!accessToken && !inAuthGroup) {
      router.replace("/login");
    } else if (accessToken && inAuthGroup) {
      router.replace("/(tabs)/home");
    }
  }, [accessToken, hydrated, segments, router]);

  // Re-fetch profile after rehydration (e.g. cold start).
  useEffect(() => {
    if (!hydrated || !accessToken || user) return;
    void api
      .get<User>("/auth/me")
      .then((r) => setUser(r.data))
      .catch(() => undefined);
  }, [hydrated, accessToken, user, setUser]);

  return <Slot />;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="dark" />
          <AuthGate />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
