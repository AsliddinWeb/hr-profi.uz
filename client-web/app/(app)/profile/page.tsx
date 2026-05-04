"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  Bell,
  CalendarDays,
  ChevronRight,
  KeyRound,
  LogOut,
  Monitor,
  Moon,
  Save,
  ShieldAlert,
  Sun,
  User as UserIcon,
} from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { setThemeMode, useThemeMode, type ThemeMode } from "@/lib/theme";
import { cn } from "@/lib/cn";
import type { User } from "@/lib/types";

interface FormState {
  full_name: string;
  email: string;
  phone: string;
  language: "uz" | "ru" | "en";
}

export default function ProfilePage() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const setUser = useAuthStore((s) => s.setUser);
  const logout = useAuthStore((s) => s.logout);

  const meQ = useQuery({
    queryKey: ["auth", "me"],
    queryFn: async () => (await api.get<User>("/auth/me")).data,
  });

  const [form, setForm] = useState<FormState | null>(null);
  useEffect(() => {
    if (meQ.data && form === null) {
      setForm({
        full_name: meQ.data.full_name ?? "",
        email: meQ.data.email ?? "",
        phone: meQ.data.phone ?? "",
        language: meQ.data.language,
      });
    }
  }, [meQ.data, form]);

  const saveMut = useMutation({
    mutationFn: async (f: FormState) => {
      const body: Record<string, unknown> = {
        full_name: f.full_name || null,
        email: f.email || null,
        phone: f.phone || null,
        language: f.language,
      };
      return (await api.patch<User>("/auth/me", body)).data;
    },
    onSuccess: (u) => {
      setUser(u);
      if (u.language && u.language !== i18n.language) {
        void i18n.changeLanguage(u.language);
      }
      qc.invalidateQueries({ queryKey: ["auth", "me"] });
      toast.success(t("profile.saved"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  // Password change form (separate piece of state — keep current/new local
  // so they're never persisted alongside profile fields).
  const [pwd, setPwd] = useState({ current: "", next: "", confirm: "" });
  const pwdMut = useMutation({
    mutationFn: async () =>
      api.post("/auth/password/change", {
        current_password: pwd.current,
        new_password: pwd.next,
      }),
    onSuccess: () => {
      toast.success(t("profile.password_changed"));
      setPwd({ current: "", next: "", confirm: "" });
      // The backend revokes refresh tokens — log out so the user re-authenticates
      // with the new password.
      logout();
      router.replace("/login");
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  if (!form || !meQ.data) {
    return (
      <p className="py-8 text-center text-sm text-slate-500">
        {t("common.loading")}
      </p>
    );
  }

  const u = meQ.data;
  const update = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));

  return (
    <div className="space-y-4">
      {/* Hero */}
      <header className="card flex items-center gap-3 p-4">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
          <UserIcon className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-bold text-slate-900">
            {u.full_name || u.username}
          </h1>
          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            <code className="font-mono">@{u.username}</code>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold uppercase">
              {u.role}
            </span>
          </div>
        </div>
      </header>

      {/* Theme picker */}
      <ThemePicker />

      {/* Quick links */}
      <div className="grid grid-cols-2 gap-2">
        <Link
          href="/notifications"
          className="card flex items-center justify-between gap-2 p-3 transition active:scale-[0.99]"
        >
          <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-700">
            <Bell className="size-4 shrink-0 text-brand-600" />
            <span className="truncate">{t("notifications.title")}</span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-slate-400" />
        </Link>
        <Link
          href="/leaves"
          className="card flex items-center justify-between gap-2 p-3 transition active:scale-[0.99]"
        >
          <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-700">
            <CalendarDays className="size-4 shrink-0 text-brand-600" />
            <span className="truncate">{t("leaves.title")}</span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-slate-400" />
        </Link>
      </div>

      {/* Personal info */}
      <form
        className="card space-y-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (form) saveMut.mutate(form);
        }}
      >
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {t("profile.info")}
        </h2>
        <div>
          <label className="label">{t("profile.full_name")}</label>
          <input
            className="input"
            value={form.full_name}
            onChange={(e) => update("full_name", e.target.value)}
          />
        </div>
        <div>
          <label className="label">{t("profile.email")}</label>
          <input
            type="email"
            className="input"
            value={form.email}
            onChange={(e) => update("email", e.target.value)}
            placeholder="user@example.com"
          />
        </div>
        <div>
          <label className="label">{t("profile.phone")}</label>
          <input
            className="input"
            value={form.phone}
            onChange={(e) => update("phone", e.target.value)}
            placeholder="+998 90 123 45 67"
          />
        </div>
        <div>
          <label className="label">{t("profile.language")}</label>
          <select
            className="input"
            value={form.language}
            onChange={(e) =>
              update("language", e.target.value as FormState["language"])
            }
          >
            <option value="uz">O&apos;zbekcha</option>
            <option value="ru">Русский</option>
            <option value="en">English</option>
          </select>
        </div>
        <button
          type="submit"
          className="btn-primary btn-block"
          disabled={saveMut.isPending}
        >
          <Save className="size-4" />
          {t("common.save")}
        </button>
      </form>

      {/* Security */}
      <form
        className="card space-y-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (pwd.next.length < 8) {
            toast.error(t("profile.password_too_short"));
            return;
          }
          if (pwd.next !== pwd.confirm) {
            toast.error(t("profile.password_mismatch"));
            return;
          }
          pwdMut.mutate();
        }}
      >
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {t("profile.security_section")}
        </h2>

        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <p>{t("profile.password_revoke_hint")}</p>
        </div>

        <div>
          <label className="label">{t("profile.current_password")}</label>
          <input
            type="password"
            className="input"
            value={pwd.current}
            onChange={(e) => setPwd({ ...pwd, current: e.target.value })}
            autoComplete="current-password"
          />
        </div>
        <div>
          <label className="label">{t("profile.new_password")}</label>
          <input
            type="password"
            className="input"
            minLength={8}
            value={pwd.next}
            onChange={(e) => setPwd({ ...pwd, next: e.target.value })}
            autoComplete="new-password"
          />
        </div>
        <div>
          <label className="label">{t("profile.confirm_password")}</label>
          <input
            type="password"
            className="input"
            minLength={8}
            value={pwd.confirm}
            onChange={(e) => setPwd({ ...pwd, confirm: e.target.value })}
            autoComplete="new-password"
          />
        </div>
        <button
          type="submit"
          className="btn-secondary btn-block"
          disabled={
            pwdMut.isPending ||
            !pwd.current ||
            !pwd.next ||
            pwd.next !== pwd.confirm
          }
        >
          <KeyRound className="size-4" />
          {t("profile.change_password")}
        </button>
      </form>

      {/* Sign-out */}
      <button
        type="button"
        onClick={() => {
          logout();
          router.replace("/login");
        }}
        className="btn-danger btn-block"
      >
        <LogOut className="size-4" />
        {t("profile.logout_btn")}
      </button>
    </div>
  );
}

function ThemePicker() {
  const { t } = useTranslation();
  const mode = useThemeMode();
  const opts: { value: ThemeMode; icon: typeof Sun; key: string }[] = [
    { value: "system", icon: Monitor, key: "profile.theme_system" },
    { value: "light", icon: Sun, key: "profile.theme_light" },
    { value: "dark", icon: Moon, key: "profile.theme_dark" },
  ];
  return (
    <div className="card p-3">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {t("profile.theme_section")}
      </h2>
      <div
        className="grid grid-cols-3 gap-1 rounded-xl p-1"
        style={{ background: "var(--secondary-bg)" }}
      >
        {opts.map((o) => {
          const Icon = o.icon;
          const active = mode === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => setThemeMode(o.value)}
              className={cn(
                "flex flex-col items-center justify-center gap-1 rounded-lg py-2 text-[11px] font-semibold transition",
                active
                  ? "bg-white text-brand-700 shadow-sm dark:bg-slate-900 dark:text-brand-400"
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
              )}
              aria-pressed={active}
            >
              <Icon className="size-4" />
              {t(o.key)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
