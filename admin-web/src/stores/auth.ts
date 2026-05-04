import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { TokenPair, User } from "@/lib/types";

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: User | null;
  setTokens: (pair: TokenPair) => void;
  setUser: (user: User | null) => void;
  setAccessToken: (token: string) => void;
  logout: () => void;
}

// localStorage is good enough for an admin app where login is fast and
// XSS-defense isn't worth the cookie-handling complexity. If we ship to a
// shared-machine context later, this should move to httpOnly cookies.
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      setTokens: ({ access_token, refresh_token }) =>
        set({ accessToken: access_token, refreshToken: refresh_token }),
      setUser: (user) => set({ user }),
      setAccessToken: (token) => set({ accessToken: token }),
      logout: () => set({ accessToken: null, refreshToken: null, user: null }),
    }),
    { name: "wtp.auth" }
  )
);
