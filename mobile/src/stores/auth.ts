import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { TokenPair, User } from "@/lib/types";

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: User | null;
  hydrated: boolean;
  setTokens: (pair: TokenPair) => void;
  setAccessToken: (token: string) => void;
  setUser: (user: User | null) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      hydrated: false,
      setTokens: ({ access_token, refresh_token }) =>
        set({ accessToken: access_token, refreshToken: refresh_token }),
      setAccessToken: (token) => set({ accessToken: token }),
      setUser: (user) => set({ user }),
      logout: () => set({ accessToken: null, refreshToken: null, user: null }),
    }),
    {
      name: "wtp.auth",
      storage: createJSONStorage(() => AsyncStorage),
      onRehydrateStorage: () => (state) => {
        if (state) state.hydrated = true;
      },
    }
  )
);
