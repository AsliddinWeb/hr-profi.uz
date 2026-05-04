"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useAuthStore } from "@/lib/auth-store";

/** Root: send the user to the right place based on their auth state. */
export default function RootPage() {
  const router = useRouter();
  const tok = useAuthStore((s) => s.accessToken);

  useEffect(() => {
    router.replace(tok ? "/today" : "/login");
  }, [router, tok]);

  return null;
}
