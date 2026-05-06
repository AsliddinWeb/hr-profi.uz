import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { KioskRead } from "@/lib/types";

/* Persisted kiosk session.
 *
 * The tablet stays signed-in indefinitely. Operators sign in once when
 * the tablet is set up and the JWT is silently refreshed by hitting
 * ``/kiosks/me`` (which also doubles as a heartbeat). When the JWT
 * eventually expires we fall back to the login screen so the operator
 * can re-authenticate. */
interface AuthState {
  accessToken: string | null;
  kiosk: KioskRead | null;
  setSession: (token: string, kiosk: KioskRead) => void;
  setKiosk: (kiosk: KioskRead) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      kiosk: null,
      setSession: (token, kiosk) => set({ accessToken: token, kiosk }),
      setKiosk: (kiosk) => set({ kiosk }),
      logout: () => set({ accessToken: null, kiosk: null }),
    }),
    { name: "hrp.kiosk.auth" }
  )
);
