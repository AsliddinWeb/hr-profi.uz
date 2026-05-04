import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Monitor, Moon, Sun } from "lucide-react";

import { setThemeMode, useThemeMode, type ThemeMode } from "@/lib/theme";
import { cn } from "@/lib/cn";

/**
 * Top-bar theme toggle. The visible icon reflects the *resolved* mode
 * (Sun for light, Moon for dark, Monitor when "system" is currently
 * mapping to either) — clicking opens a 3-option dropdown so an admin
 * who wants to override OS preference can do it without diving into the
 * user menu.
 */
export function ThemeToggle() {
  const { t } = useTranslation();
  const mode = useThemeMode();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Resolve which icon to draw. ``system`` reads the live OS preference so
  // the icon flips when the user changes their OS theme without explicit
  // mode change.
  const resolved =
    mode === "system"
      ? typeof window !== "undefined" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : mode;
  const Icon = mode === "system" ? Monitor : resolved === "dark" ? Moon : Sun;

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const opts: { value: ThemeMode; icon: typeof Sun; key: string }[] = [
    { value: "system", icon: Monitor, key: "user_menu.theme_system" },
    { value: "light", icon: Sun, key: "user_menu.theme_light" },
    { value: "dark", icon: Moon, key: "user_menu.theme_dark" },
  ];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "btn-icon",
          open && "bg-ink-100"
        )}
        aria-label={t("user_menu.theme")}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Icon className="size-5 text-ink-600" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-44 overflow-hidden rounded-xl border border-[var(--card-border)] bg-white shadow-pop"
        >
          {opts.map((o) => {
            const O = o.icon;
            const active = mode === o.value;
            return (
              <button
                key={o.value}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  setThemeMode(o.value);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 px-4 py-2 text-sm transition-colors",
                  active
                    ? "bg-brand-50 font-semibold text-brand-700"
                    : "text-ink-700 hover:bg-ink-50"
                )}
              >
                <O className={cn("size-4", active ? "text-brand-600" : "text-ink-500")} />
                {t(o.key)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
