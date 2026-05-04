import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Save } from "lucide-react";

import { apiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useEnumLabel } from "@/lib/enum";

import {
  CURRENCIES,
  PLAN_OPTS,
  TIMEZONES,
  type CompanyFormState,
} from "./utils";

type Mode = "create" | "edit";

export function CompanyForm({
  mode,
  initial,
  onSubmit,
  onCancel,
  saving,
  error,
}: {
  mode: Mode;
  initial: CompanyFormState;
  onSubmit: (state: CompanyFormState) => Promise<void> | void;
  onCancel: () => void;
  saving?: boolean;
  error?: unknown;
}) {
  const { t } = useTranslation();
  const label = useEnumLabel();
  const [form, setForm] = useState<CompanyFormState>(initial);

  const update = <K extends keyof CompanyFormState>(
    k: K,
    v: CompanyFormState[K]
  ) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit(form);
      }}
    >
      {/* Identity */}
      <Section
        title={t("owner_companies.section_identity")}
        hint={t("owner_companies.section_identity_hint")}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            label={t("owner_companies.name") + " *"}
            required
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            placeholder="Acme LLC"
          />
          <Input
            label={t("owner_companies.slug") + " *"}
            required
            value={form.slug}
            onChange={(e) =>
              update("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
            }
            placeholder="acme"
            hint={t("owner_companies.slug_hint") ?? undefined}
          />
        </div>
        <Input
          label={t("owner_companies.logo_url")}
          value={form.logo_url}
          onChange={(e) => update("logo_url", e.target.value)}
          placeholder="https://…/logo.png"
        />
        {form.logo_url && (
          <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
            <img
              src={form.logo_url}
              alt=""
              className="size-12 rounded-md object-contain ring-1 ring-slate-200"
            />
            <p className="text-[11px] text-slate-500">
              {t("owner_companies.logo_preview_hint")}
            </p>
          </div>
        )}
      </Section>

      {/* Locale */}
      <Section
        title={t("owner_companies.section_locale")}
        hint={t("owner_companies.section_locale_hint")}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            label={t("owner_companies.country")}
            value={form.country}
            onChange={(e) => update("country", e.target.value.toUpperCase())}
            placeholder="UZ"
          />
          <div>
            <label className="label">{t("owner_companies.timezone")}</label>
            <select
              className="input"
              value={form.timezone}
              onChange={(e) => update("timezone", e.target.value)}
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">{t("owner_companies.currency")}</label>
            <select
              className="input"
              value={form.currency}
              onChange={(e) => update("currency", e.target.value)}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">
              {t("owner_companies.language_default")}
            </label>
            <select
              className="input"
              value={form.language_default}
              onChange={(e) =>
                update(
                  "language_default",
                  e.target.value as CompanyFormState["language_default"]
                )
              }
            >
              <option value="uz">O'zbekcha</option>
              <option value="ru">Русский</option>
              <option value="en">English</option>
            </select>
          </div>
        </div>
      </Section>

      {/* Plan & subscription */}
      <Section
        title={t("owner_companies.section_plan")}
        hint={t("owner_companies.section_plan_hint")}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label">{t("owner_companies.plan") + " *"}</label>
            <select
              className="input"
              value={form.plan}
              onChange={(e) =>
                update("plan", e.target.value as CompanyFormState["plan"])
              }
            >
              {PLAN_OPTS.map((p) => (
                <option key={p} value={p}>
                  {label("company_plan", p)}
                </option>
              ))}
            </select>
          </div>
          <Input
            type="date"
            label={t("owner_companies.subscription_until")}
            value={form.subscription_until}
            onChange={(e) => update("subscription_until", e.target.value)}
            hint={t("owner_companies.subscription_until_hint") ?? undefined}
          />
        </div>
      </Section>

      {/* Admin user — create only */}
      {mode === "create" && (
        <Section
          title={t("owner_companies.section_admin")}
          hint={t("owner_companies.section_admin_hint")}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              label={t("owner_companies.admin_username") + " *"}
              required
              value={form.admin_username}
              onChange={(e) => update("admin_username", e.target.value)}
              placeholder="admin"
              autoComplete="off"
            />
            <Input
              type="password"
              label={t("owner_companies.admin_password") + " *"}
              required
              minLength={8}
              value={form.admin_password}
              onChange={(e) => update("admin_password", e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
              hint={t("owner_companies.admin_password_hint") ?? undefined}
            />
            <Input
              label={t("owner_companies.admin_full_name")}
              value={form.admin_full_name}
              onChange={(e) => update("admin_full_name", e.target.value)}
              placeholder="Jane Doe"
            />
            <Input
              type="email"
              label={t("owner_companies.admin_email")}
              value={form.admin_email}
              onChange={(e) => update("admin_email", e.target.value)}
              placeholder="admin@acme.com"
            />
          </div>
        </Section>
      )}

      {!!error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {apiErrorMessage(error)}
        </div>
      )}

      <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" loading={saving}>
          <Save className="size-4" />
          {mode === "edit" ? t("common.save_changes") : t("common.create")}
        </Button>
      </div>
    </form>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <header>
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        {hint && <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p>}
      </header>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
