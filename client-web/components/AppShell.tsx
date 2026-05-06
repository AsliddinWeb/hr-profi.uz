"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import type { User } from "@/lib/types";

import { BottomNav } from "./BottomNav";
import { InstallHint } from "./InstallHint";

/** Authenticated wrapper. If the user has no token (or the persisted state
 * hasn't hydrated yet) we either bounce to /login or show a tiny spinner.
 *
 * Also refreshes ``/auth/me`` on mount so admin-side renames (e.g.
 * Employee.full_name change which mirrors onto User.full_name) propagate
 * into the persisted Zustand store without forcing the user to log out
 * and back in. ``visibilitychange`` re-runs the fetch when the tab comes
 * back to focus so a phone left on the home screen also picks up edits. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const tok = useAuthStore((s) => s.accessToken);
  const setUser = useAuthStore((s) => s.setUser);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated && !tok) {
      router.replace("/login");
    }
  }, [hydrated, tok, router]);

  // Refresh the cached user on mount + when the tab is foregrounded.
  useEffect(() => {
    if (!tok) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const me = (await api.get<User>("/auth/me")).data;
        if (!cancelled) setUser(me);
      } catch {
        // Network blip — keep the cached user, the next interaction will retry.
      }
    };
    void refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [tok, setUser]);

  if (!hydrated || !tok) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
        ...
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-md px-4 pb-24 pt-4">
      <InstallHint />
      {children}
      <BottomNav />
    </div>
  );
}
