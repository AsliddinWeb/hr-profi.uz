"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslation } from "react-i18next";
import { CalendarRange, Clock, Coins, Trophy, User } from "lucide-react";

import { cn } from "@/lib/cn";

const TABS = [
  { href: "/today", icon: Clock, key: "nav.today" },
  { href: "/shifts", icon: CalendarRange, key: "nav.shifts" },
  { href: "/salary", icon: Coins, key: "nav.salary" },
  { href: "/kpi", icon: Trophy, key: "nav.kpi" },
  { href: "/profile", icon: User, key: "nav.profile" },
] as const;

export function BottomNav() {
  const { t } = useTranslation();
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/85"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto grid max-w-md grid-cols-5">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = pathname?.startsWith(tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 px-3 py-2.5 text-[11px] transition",
                  active
                    ? "text-brand-700"
                    : "text-slate-500 hover:text-slate-800"
                )}
              >
                <Icon
                  className={cn(
                    "size-5 transition",
                    active && "scale-110"
                  )}
                />
                <span className={cn(active && "font-bold")}>
                  {t(tab.key)}
                </span>
                <span
                  className={cn(
                    "h-0.5 w-6 rounded-full transition-colors",
                    active ? "bg-brand-600" : "bg-transparent"
                  )}
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
