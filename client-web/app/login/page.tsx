"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, LogIn } from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import type { TokenPair, User } from "@/lib/types";

export default function LoginPage() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const setTokens = useAuthStore((s) => s.setTokens);
  const setUser = useAuthStore((s) => s.setUser);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const loginMut = useMutation({
    mutationFn: async () => {
      const tokens = (
        await api.post<TokenPair>("/auth/login", { username, password })
      ).data;
      setTokens(tokens.access_token, tokens.refresh_token);
      // Fetch /auth/me with the new token to populate the user payload.
      const me = (await api.get<User>("/auth/me")).data;
      return me;
    },
    onSuccess: (me) => {
      // The client-web is for employees only. Admins get bounced to the
      // admin web. We don't try to deep-link to /app — the admin web is
      // a separate origin in production.
      if (me.role !== "EMPLOYEE") {
        toast.error(t("login.wrong_role"));
        useAuthStore.getState().logout();
        return;
      }
      setUser(me);
      // Sync UI language to the user's preference.
      if (me.language && me.language !== i18n.language) {
        void i18n.changeLanguage(me.language);
      }
      router.replace("/today");
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-brand-50 to-slate-100 px-4 py-8 dark:from-slate-900 dark:to-slate-950">
      <div className="card w-full max-w-md p-6">
        <div className="mb-5 flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-brand-600 text-white">
            <Building2 className="size-5" />
          </span>
          <div>
            <h1 className="text-lg font-bold text-slate-900">
              {t("app.name")}
            </h1>
            <p className="text-xs text-slate-500">{t("app.tagline")}</p>
          </div>
        </div>

        <h2 className="text-base font-semibold text-slate-800">
          {t("login.title")}
        </h2>
        <p className="mt-1 text-xs text-slate-500">{t("login.subtitle")}</p>

        <form
          className="mt-5 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            loginMut.mutate();
          }}
        >
          <div>
            <label className="label">{t("login.username")}</label>
            <input
              className="input"
              type="text"
              required
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div>
            <label className="label">{t("login.password")}</label>
            <input
              className="input"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button
            type="submit"
            className="btn-primary btn-block mt-2"
            disabled={loginMut.isPending}
          >
            <LogIn className="size-4" />
            {loginMut.isPending ? "..." : t("login.submit")}
          </button>
        </form>

        <div className="mt-5 flex items-center justify-center gap-1.5 text-xs text-slate-500">
          <span>{t("login.lang")}:</span>
          {(["uz", "ru", "en"] as const).map((lng) => (
            <button
              key={lng}
              type="button"
              onClick={() => void i18n.changeLanguage(lng)}
              className={`rounded-md px-2 py-0.5 font-mono uppercase ${
                i18n.language === lng
                  ? "bg-brand-600 text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {lng}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
