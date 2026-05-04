import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Save } from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useAuthStore } from "@/stores/auth";
import type { Company } from "@/lib/types";

import { ReadonlyField, Section } from "./components";

interface FormState {
  name: string;
  slug: string;
  logo_url: string;
  country: string;
  timezone: string;
  currency: string;
  language_default: "uz" | "ru" | "en";
}

const TIMEZONES = [
  "Asia/Tashkent",
  "Asia/Almaty",
  "Asia/Bishkek",
  "Asia/Dushanbe",
  "Asia/Ashgabat",
  "Europe/Moscow",
  "UTC",
];
const CURRENCIES = ["UZS", "USD", "RUB", "EUR", "KZT"];

export function CompanyTab() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const isOwner = me?.role === "OWNER";
  const [form, setForm] = useState<FormState | null>(null);

  const companyQ = useQuery({
    queryKey: ["company", "me"],
    queryFn: async () => (await api.get<Company>("/companies/me")).data,
  });

  useEffect(() => {
    if (companyQ.data && form === null) {
      setForm({
        name: companyQ.data.name,
        slug: companyQ.data.slug,
        logo_url: companyQ.data.logo_url ?? "",
        country: companyQ.data.country,
        timezone: companyQ.data.timezone,
        currency: companyQ.data.currency,
        language_default: companyQ.data.language_default,
      });
    }
  }, [companyQ.data, form]);

  const saveMut = useMutation({
    mutationFn: async (f: FormState) => {
      const body: Record<string, unknown> = {
        name: f.name,
        country: f.country,
        timezone: f.timezone,
        currency: f.currency,
        language_default: f.language_default,
      };
      body.logo_url = f.logo_url || null;
      // slug is immutable for non-Owner; backend will reject if changed
      if (isOwner) body.slug = f.slug;
      return (await api.patch<Company>("/companies/me", body)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["company"] });
      toast.success(t("settings_page.saved"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  if (!form || !companyQ.data) {
    return <p className="text-sm text-slate-500">{t("common.loading")}</p>;
  }

  const c = companyQ.data;
  const update = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (form) saveMut.mutate(form);
      }}
    >
      {/* Identity */}
      <Section
        title={t("settings_page.section_company_identity")}
        hint={t("settings_page.section_company_identity_hint")}
      >
        <Input
          label={t("settings_page.company_name") + " *"}
          required
          value={form.name}
          onChange={(e) => update("name", e.target.value)}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            label={t("settings_page.company_slug")}
            value={form.slug}
            onChange={(e) => update("slug", e.target.value)}
            disabled={!isOwner}
            hint={
              isOwner
                ? (t("settings_page.slug_hint") ?? undefined)
                : (t("settings_page.slug_locked_hint") ?? undefined)
            }
          />
          <Input
            label={t("settings_page.logo_url")}
            value={form.logo_url}
            onChange={(e) => update("logo_url", e.target.value)}
            placeholder="https://…/logo.png"
          />
        </div>
        {form.logo_url && (
          <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
            <img
              src={form.logo_url}
              alt=""
              className="size-12 rounded-md object-contain ring-1 ring-slate-200"
            />
            <p className="text-[11px] text-slate-500">
              {t("settings_page.logo_preview_hint")}
            </p>
          </div>
        )}
      </Section>

      {/* Locale + currency */}
      <Section
        title={t("settings_page.section_locale")}
        hint={t("settings_page.section_locale_hint")}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label">{t("settings_page.country")}</label>
            <Input
              value={form.country}
              onChange={(e) => update("country", e.target.value)}
              placeholder="UZ"
            />
          </div>
          <div>
            <label className="label">{t("settings_page.timezone")}</label>
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
            <label className="label">{t("settings_page.currency")}</label>
            <select
              className="input"
              value={form.currency}
              onChange={(e) => update("currency", e.target.value)}
            >
              {CURRENCIES.map((cur) => (
                <option key={cur} value={cur}>
                  {cur}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">{t("settings_page.language_default")}</label>
            <select
              className="input"
              value={form.language_default}
              onChange={(e) =>
                update("language_default", e.target.value as FormState["language_default"])
              }
            >
              <option value="uz">O'zbekcha</option>
              <option value="ru">Русский</option>
              <option value="en">English</option>
            </select>
          </div>
        </div>
      </Section>

      {/* Plan / subscription — read-only for non-Owner */}
      <Section
        title={t("settings_page.section_subscription")}
        hint={
          isOwner
            ? t("settings_page.section_subscription_owner_hint") ?? undefined
            : t("settings_page.section_subscription_admin_hint") ?? undefined
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <ReadonlyField
            label={t("settings_page.plan")}
            value={c.plan}
          />
          <ReadonlyField
            label={t("settings_page.subscription_until")}
            value={
              c.subscription_until
                ? new Date(c.subscription_until).toLocaleDateString(i18n.language)
                : "—"
            }
            hint={t("settings_page.subscription_owner_only_hint") ?? undefined}
          />
          <ReadonlyField
            label={t("settings_page.created_at")}
            value={
              c.created_at
                ? new Date(c.created_at).toLocaleDateString(i18n.language)
                : "—"
            }
          />
        </div>
      </Section>

      <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
        <Button type="submit" loading={saveMut.isPending}>
          <Save className="size-4" />
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}
