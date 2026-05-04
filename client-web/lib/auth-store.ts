import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { User } from "./types";

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: User | null;
  setTokens: (access: string, refresh: string) => void;
  setUser: (u: User | null) => void;
  logout: () => void;
}

/**
 * Persisted auth state. Lives in localStorage under ``wtp.client.auth`` —
 * separate key from admin-web so an admin tab and an employee tab can be
 * open in the same browser without stomping each other.
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      setTokens: (access, refresh) =>
        set({ accessToken: access, refreshToken: refresh }),
      setUser: (u) => set({ user: u }),
      logout: () =>
        set({ accessToken: null, refreshToken: null, user: null }),
    }),
    { name: "wtp.client.auth" }
  )
);
