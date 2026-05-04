import Constants from "expo-constants";

const extra = (Constants.expoConfig?.extra ?? {}) as {
  apiUrl?: string;
  wsUrl?: string;
};

// Order: env var (set via EAS / EXPO_PUBLIC_*) → app.json extra → localhost.
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? extra.apiUrl ?? "http://localhost:8000/api/v1";

export const WS_URL =
  process.env.EXPO_PUBLIC_WS_URL ?? extra.wsUrl ?? "ws://localhost:8000/ws";
