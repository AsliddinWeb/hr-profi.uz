import axios, {
  AxiosError,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from "axios";

import i18n from "@/i18n";
import { API_URL } from "@/lib/env";
import type { ApiError, TokenPair } from "@/lib/types";
import { useAuthStore } from "@/stores/auth";

export const api = axios.create({
  baseURL: API_URL,
  headers: { "Content-Type": "application/json" },
  // RN doesn't enforce withCredentials anyway; keep it explicit.
  timeout: 15000,
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.set("Authorization", `Bearer ${token}`);
  }
  config.headers.set("Accept-Language", i18n.language || "uz");
  return config;
});

let refreshing: Promise<string | null> | null = null;

async function attemptRefresh(): Promise<string | null> {
  const refreshToken = useAuthStore.getState().refreshToken;
  if (!refreshToken) return null;
  try {
    const { data } = await axios.post<TokenPair>(
      `${API_URL}/auth/refresh`,
      { refresh_token: refreshToken },
      { headers: { "Content-Type": "application/json" } }
    );
    useAuthStore.getState().setTokens(data);
    return data.access_token;
  } catch {
    useAuthStore.getState().logout();
    return null;
  }
}

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError<ApiError>) => {
    const original = error.config as
      | (AxiosRequestConfig & { _retried?: boolean })
      | undefined;

    if (error.response?.status === 401 && original && !original._retried) {
      if (original.url?.includes("/auth/refresh")) {
        useAuthStore.getState().logout();
        return Promise.reject(error);
      }
      original._retried = true;
      refreshing ??= attemptRefresh().finally(() => {
        refreshing = null;
      });
      const newToken = await refreshing;
      if (newToken) {
        original.headers = {
          ...(original.headers ?? {}),
          Authorization: `Bearer ${newToken}`,
        };
        return api.request(original);
      }
    }
    return Promise.reject(error);
  }
);

export function apiErrorMessage(error: unknown, fallback = "Error"): string {
  if (axios.isAxiosError<ApiError>(error)) {
    return error.response?.data?.message || error.message || fallback;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}
