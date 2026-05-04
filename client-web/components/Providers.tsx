"use client";

import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { Toaster } from "sonner";

import i18n from "@/lib/i18n";
import { initTheme } from "@/lib/theme";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            staleTime: 30_000,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  // Register the service worker once the page hydrates. The SW lives at
  // /sw.js (served from /public). Failures are non-fatal — the app still
  // works without offline support.
  useEffect(() => {
    initTheme();
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker
        .register("/sw.js")
        .catch((err) => console.warn("[sw] registration failed", err));
    }
  }, []);

  return (
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        {children}
        <Toaster position="top-center" richColors theme="system" />
      </I18nextProvider>
    </QueryClientProvider>
  );
}
