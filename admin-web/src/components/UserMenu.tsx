import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  LogOut,
  Monitor,
  Moon,
  Settings as SettingsIcon,
  Sun,
  User as UserIcon,
} from "lucide-react";

import { Avatar } from "@/components/ui/Avatar";
import { useAuthStore } from "@/stores/auth";
import { useEnumLabel } from "@/lib/enum";
import { setThemeMode, useThemeMode, type ThemeMode } from "@/lib/theme";
import { cn } from "@/lib/cn";

export function UserMenu() {
  const { t } = useTranslation();
  const label = useEnumLabel();
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const onLogout = () => {
    setOpen(false);
    logout();
    navigate("/login", { replace: true });
  };

  const isOwner = user?.role === "OWNER";
  const settingsTo = isOwner ? "/owner" : "/app/settings";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-2 rounded-full p-1 pr-2 transition-colors hover:bg-ink-100",
          open && "bg-ink-100"
        )}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Avatar name={user?.full_name || user?.username} size="sm" />
        <span className="hidden text-left sm:block">
          <span className="block text-xs font-semibold leading-tight text-ink-900">
            {user?.full_name || user?.username}
          </span>
          <span className="block text-[10px] uppercase tracking-wider text-ink-500">
            {label("role", user?.role)}
          </span>
        </span>
        <ChevronDown className="size-4 text-ink-500" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-64 max-w-[calc(100vw-1rem)] overflow-hidden rounded-2xl border border-[var(--card-border)] bg-white shadow-pop"
        >
          {/* Header */}
          <div className="flex items-center gap-3 border-b border-[var(--card-border)] px-4 py-3.5">
            <Avatar name={user?.full_name || user?.username} size="md" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink-900">
                {user?.full_name || user?.username}
              </p>
              <p className="truncate text-xs text-ink-500">
                {user?.email || label("role", user?.role)}
              </p>
            </div>
          </div>

          {/* Items */}
          <div className="py-1">
            <Link
              to={settingsTo}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-4 py-2 text-sm text-ink-700 hover:bg-ink-50"
            >
              <UserIcon className="size-4 text-ink-500" />
              {t("user_menu.profile")}
            </Link>
            {!isOwner && (
              <Link
                to="/app/settings"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 px-4 py-2 text-sm text-ink-700 hover:bg-ink-50"
              >
                <SettingsIcon className="size-4 text-ink-500" />
                {t("user_menu.settings")}
              </Link>
            )}
          </div>

          <div className="border-t border-[var(--card-border)] px-4 py-3">
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-500">
              {t("user_menu.theme")}
            </p>
            <ThemeRow />
          </div>

          <div className="border-t border-[var(--card-border)] py-1">
            <button
              onClick={onLogout}
              className="flex w-full items-center gap-2.5 px-4 py-2 text-sm text-rose-600 hover:bg-rose-50"
            >
              <LogOut className="size-4" />
              {t("auth.logout")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ThemeRow() {
  const { t } = useTranslation();
  const mode = useThemeMode();
  const opts: { value: ThemeMode; icon: typeof Sun; key: string }[] = [
    { value: "system", icon: Monitor, key: "user_menu.theme_system" },
    { value: "light", icon: Sun, key: "user_menu.theme_light" },
    { value: "dark", icon: Moon, key: "user_menu.theme_dark" },
  ];
  return (
    <div className="grid grid-cols-3 gap-1 rounded-lg bg-ink-100 p-0.5">
      {opts.map((o) => {
        const Icon = o.icon;
        const active = mode === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => setThemeMode(o.value)}
            className={cn(
              "flex flex-col items-center justify-center gap-0.5 rounded-md py-1.5 text-[10px] font-semibold transition",
              active
                ? "bg-white text-brand-700 shadow-sm dark:bg-ink-900 dark:text-brand-400"
                : "text-ink-600 hover:text-ink-900"
            )}
            aria-pressed={active}
          >
            <Icon className="size-3.5" />
            {t(o.key)}
          </button>
        );
      })}
    </div>
  );
}
