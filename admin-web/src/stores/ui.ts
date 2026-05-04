import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UIState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;
  /** Mobile drawer is a separate piece of state — desktop "collapsed" is
   * a UX preference that persists, mobile "open" is volatile per-session. */
  mobileSidebarOpen: boolean;
  toggleMobileSidebar: () => void;
  setMobileSidebar: (v: boolean) => void;
}

/**
 * Tiny store for cross-cutting UI state. Persisted so the sidebar stays in
 * the user's preferred mode across reloads. Add other layout-wide flags
 * (theme, density, etc.) here as the app grows.
 */
export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
      mobileSidebarOpen: false,
      toggleMobileSidebar: () =>
        set((s) => ({ mobileSidebarOpen: !s.mobileSidebarOpen })),
      setMobileSidebar: (v) => set({ mobileSidebarOpen: v }),
    }),
    {
      name: "wtp.ui",
      // Don't persist the mobile drawer state — it should always be closed
      // on first paint after a reload.
      partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed }) as Partial<UIState>,
    }
  )
);
