import axios, { AxiosError, AxiosRequestConfig } from "axios";

import { useAuthStore } from "./auth-store";
import type { TokenPair } from "./types";

/**
 * One axios instance for every request. The base URL is the Next.js rewrite
 * (``/api/v1``) so we never hit CORS — Traefik / nginx proxies to FastAPI.
 *
 * Auth handling: the request interceptor injects the access token. The
 * response interceptor catches 401s, queues parallel requests, and retries
 * once with a refreshed access token. If the refresh itself fails, the user
 * is logged out and bounced to /login.
 */
export const api = axios.create({
  baseURL: "/api/v1",
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config) => {
  const tok = useAuthStore.getState().accessToken;
  if (tok) {
    config.headers = config.headers ?? {};
    (config.headers as Record<string, string>).Authorization = `Bearer ${tok}`;
  }
  // Send the user's preferred language to the backend so error messages and
  // notification titles come back localised.
  const lang = useAuthStore.getState().user?.language;
  if (lang) {
    (config.headers as Record<string, string>)["Accept-Language"] = lang;
  }
  return config;
});

let refreshing: Promise<string> | null = null;

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const original = error.config as AxiosRequestConfig & { _retry?: boolean };
    const status = error.response?.status;

    // Only auto-refresh once per original request; skip the auth endpoints
    // themselves so we don't loop on a bad password.
    const isAuthCall = original?.url?.startsWith("/auth/");
    if (status === 401 && !original?._retry && !isAuthCall) {
      original._retry = true;
      try {
        if (!refreshing) {
          const refreshTok = useAuthStore.getState().refreshToken;
          if (!refreshTok) throw new Error("no refresh token");
          refreshing = api
            .post<TokenPair>("/auth/refresh", { refresh_token: refreshTok })
            .then((resp) => {
              useAuthStore
                .getState()
                .setTokens(resp.data.access_token, resp.data.refresh_token);
              return resp.data.access_token;
            })
            .finally(() => {
              refreshing = null;
            });
        }
        const newTok = await refreshing;
        original.headers = original.headers ?? {};
        (original.headers as Record<string, string>).Authorization = `Bearer ${newTok}`;
        return api(original);
      } catch {
        useAuthStore.getState().logout();
        if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
          window.location.href = "/login";
        }
        return Promise.reject(error);
      }
    }

    return Promise.reject(error);
  }
);

/** Pull a friendly message out of a backend error envelope. */
export function apiErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { message?: string; detail?: string } | undefined;
    return data?.message || data?.detail || err.message || "Request failed";
  }
  if (err instanceof Error) return err.message;
  return "Request failed";
}
