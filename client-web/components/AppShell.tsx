"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { useAuthStore } from "@/lib/auth-store";

import { BottomNav } from "./BottomNav";
import { InstallHint } from "./InstallHint";

/** Authenticated wrapper. If the user has no token (or the persisted state
 * hasn't hydrated yet) we either bounce to /login or show a tiny spinner. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const tok = useAuthStore((s) => s.accessToken);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated && !tok) {
      router.replace("/login");
    }
  }, [hydrated, tok, router]);

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
