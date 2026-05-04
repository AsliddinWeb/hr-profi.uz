import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import App from "@/App";
import { initTheme } from "@/lib/theme";
import "@/i18n";
import "@/styles/globals.css";

// Apply persisted theme (system/light/dark) and wire the system-preference
// listener. The FOUC-preventing flash-of-light-on-dark is handled by an
// inline boot script in index.html.
initTheme();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
