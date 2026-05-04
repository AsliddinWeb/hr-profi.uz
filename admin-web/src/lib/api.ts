import axios, {
  AxiosError,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from "axios";
import i18n from "@/i18n";
import { useAuthStore } from "@/stores/auth";
import type { ApiError, TokenPair } from "@/lib/types";

const API_BASE = import.meta.env.VITE_API_URL || "/api/v1";

export const api = axios.create({
  baseURL: API_BASE,
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.set("Authorization", `Bearer ${token}`);
  }
  config.headers.set("Accept-Language", i18n.language || "uz");
  return config;
});

// Single-flight refresh: while one request is rotating tokens, queue the rest
// and replay them with the new access token.
let refreshing: Promise<string | null> | null = null;

async function attemptRefresh(): Promise<string | null> {
  const refreshToken = useAuthStore.getState().refreshToken;
  if (!refreshToken) return null;
  try {
    const { data } = await axios.post<TokenPair>(
      `${API_BASE}/auth/refresh`,
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
      // Skip the loop on the refresh endpoint itself.
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

export function apiErrorMessage(error: unknown, fallback = "An error occurred"): string {
  if (axios.isAxiosError<ApiError>(error)) {
    return error.response?.data?.message || error.message || fallback;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}
