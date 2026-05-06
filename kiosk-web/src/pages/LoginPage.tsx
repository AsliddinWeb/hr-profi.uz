import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Tablet } from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";
import type { KioskLoginResponse } from "@/lib/types";
import { LangSwitcher } from "@/components/LangSwitcher";

export function LoginPage({ slugFromUrl }: { slugFromUrl: string | null }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);

  const [slug, setSlug] = useState(slugFromUrl ?? "");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!slug.trim() || !password) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await api.post<KioskLoginResponse>("/kiosks/auth/login", {
        slug: slug.trim().toLowerCase(),
        password,
      });
      setSession(r.data.access_token, r.data.kiosk);
      navigate(`/${r.data.kiosk.slug}`, { replace: true });
    } catch (e) {
      setError(apiErrorMessage(e, t("login.wrong_credentials")));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-brand-700 via-brand-600 to-brand-800 p-6">
      <div className="absolute right-4 top-4">
        <LangSwitcher dark />
      </div>

      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl ring-1 ring-black/5"
      >
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-md">
            <Tablet className="size-7" />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-ink-900">
              {t("login.title")}
            </h1>
            <p className="mt-1 text-sm text-ink-500">{t("login.subtitle")}</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-700">
              {t("login.slug_label")}
            </label>
            <input
              className="input-lg"
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder={t("login.slug_placeholder") ?? ""}
              required
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-700">
              {t("login.password_label")}
            </label>
            <input
              type="password"
              className="input-lg"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus={Boolean(slugFromUrl)}
            />
          </div>

          {error && (
            <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              {error}
            </p>
          )}

          <button
            type="submit"
            className="btn-primary w-full text-lg"
            disabled={submitting || !slug.trim() || !password}
          >
            {submitting ? t("login.submitting") : t("login.submit")}
          </button>
        </div>

        {!slugFromUrl && (
          <div className="mt-6 rounded-xl bg-ink-50 p-3 text-xs leading-relaxed text-ink-600">
            <p className="font-semibold text-ink-700">
              {t("login.url_hint_title")}
            </p>
            <p>{t("login.url_hint_body")}</p>
          </div>
        )}
      </form>
    </div>
  );
}
