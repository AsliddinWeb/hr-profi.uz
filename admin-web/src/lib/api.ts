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

/* Pydantic ``string_too_short`` / ``string_too_long`` etc. We surface
 * these as friendlier messages — the raw "String should have at least
 * 8 characters" reads as a stack trace to operators who just see a red
 * toast. ``min_length`` / ``max_length`` live under ``ctx``. */
interface ValidationDetail {
  type: string;
  loc: (string | number)[];
  msg: string;
  ctx?: Record<string, unknown>;
}

function describeValidationError(d: ValidationDetail): string | null {
  const field = d.loc?.slice(1).join(".") ?? "";
  const fieldLabel = field || "value";
  const ctx = d.ctx ?? {};
  switch (d.type) {
    case "string_too_short": {
      const n = ctx.min_length;
      return n != null
        ? `${fieldLabel}: min ${n} chars`
        : `${fieldLabel}: ${d.msg}`;
    }
    case "string_too_long": {
      const n = ctx.max_length;
      return n != null
        ? `${fieldLabel}: max ${n} chars`
        : `${fieldLabel}: ${d.msg}`;
    }
    case "missing":
      return `${fieldLabel}: required`;
    case "value_error":
    case "type_error":
      return `${fieldLabel}: ${d.msg}`;
    default:
      return d.msg ? `${fieldLabel}: ${d.msg}` : null;
  }
}

export function apiErrorMessage(error: unknown, fallback = "An error occurred"): string {
  if (axios.isAxiosError<ApiError>(error)) {
    const data = error.response?.data;
    // Validation errors arrive as a populated ``errors`` array; surface
    // the first one in human-readable form so toasts stop reading like
    // a JSON dump.
    if (
      data?.errors &&
      Array.isArray(data.errors) &&
      data.errors.length > 0
    ) {
      const first = data.errors[0] as ValidationDetail;
      const described = describeValidationError(first);
      if (described) return described;
    }
    return data?.message || error.message || fallback;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}
