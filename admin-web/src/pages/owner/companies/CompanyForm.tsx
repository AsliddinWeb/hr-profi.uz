import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Building2,
  Calendar,
  Globe2,
  ImagePlus,
  Loader2,
  Save,
  Sparkles,
  Trash2,
  Upload,
  UserPlus,
} from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useEnumLabel } from "@/lib/enum";
import { cn } from "@/lib/cn";

import {
  COUNTRIES,
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
  companyId,
}: {
  mode: Mode;
  initial: CompanyFormState;
  onSubmit: (state: CompanyFormState) => Promise<void> | void;
  onCancel: () => void;
  saving?: boolean;
  error?: unknown;
  /** When editing — used for logo upload tenant scoping. */
  companyId?: string;
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
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit(form);
      }}
    >
      {/* Identity */}
      <Section
        icon={<Building2 className="size-4" />}
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
            prefix={<span className="text-[11px]">/</span>}
          />
        </div>

        <LogoField
          mode={mode}
          companyId={companyId}
          value={form.logo_url}
          onChange={(v) => update("logo_url", v)}
          companyName={form.name}
        />
      </Section>

      {/* Locale */}
      <Section
        icon={<Globe2 className="size-4" />}
        title={t("owner_companies.section_locale")}
        hint={t("owner_companies.section_locale_hint")}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="label">{t("owner_companies.country")}</label>
            <select
              className="input"
              value={form.country}
              onChange={(e) => update("country", e.target.value)}
            >
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.flag}  {c.name}  ({c.code})
                </option>
              ))}
            </select>
          </div>
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
              <option value="uz">🇺🇿 O'zbekcha</option>
              <option value="ru">🇷🇺 Русский</option>
              <option value="en">🇬🇧 English</option>
            </select>
          </div>
        </div>
      </Section>

      {/* Plan & subscription */}
      <Section
        icon={<Sparkles className="size-4" />}
        title={t("owner_companies.section_plan")}
        hint={t("owner_companies.section_plan_hint")}
      >
        <PlanPicker
          value={form.plan}
          onChange={(p) => update("plan", p)}
          labelFn={(p) => label("company_plan", p)}
        />
        <div className="mt-3">
          <Input
            type="date"
            label={t("owner_companies.subscription_until")}
            value={form.subscription_until}
            onChange={(e) => update("subscription_until", e.target.value)}
            hint={
              form.subscription_until
                ? formatRemaining(form.subscription_until, t)
                : (t("owner_companies.subscription_until_hint") ?? undefined)
            }
            prefix={<Calendar className="size-3.5" />}
          />
        </div>
      </Section>

      {/* Admin user — create only */}
      {mode === "create" && (
        <Section
          icon={<UserPlus className="size-4" />}
          title={t("owner_companies.section_admin")}
          hint={t("owner_companies.section_admin_hint")}
          tone="indigo"
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

      <div className="sticky bottom-0 -mx-1 flex justify-end gap-2 border-t border-slate-200 bg-white/85 px-1 py-3 backdrop-blur">
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

/* ------------------------------------------------------------------ */
/* Section card with icon header.                                      */
/* ------------------------------------------------------------------ */

function Section({
  icon,
  title,
  hint,
  tone = "slate",
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  hint?: string;
  tone?: "slate" | "indigo";
  children: React.ReactNode;
}) {
  const iconCls =
    tone === "indigo"
      ? "bg-indigo-100 text-indigo-700"
      : "bg-brand-100 text-brand-700";
  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <header className="flex items-start gap-3">
        {icon && (
          <span
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-lg",
              iconCls
            )}
          >
            {icon}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
          {hint && <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p>}
        </div>
      </header>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Logo field — file upload (edit) or hint (create).                  */
/* ------------------------------------------------------------------ */

function LogoField({
  mode,
  companyId,
  value,
  onChange,
  companyName,
}: {
  mode: Mode;
  companyId?: string;
  value: string;
  onChange: (url: string) => void;
  companyName: string;
}) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    if (!companyId) return;
    if (file.size > 5 * 1024 * 1024) {
      setErr(t("owner_companies.logo_too_large"));
      return;
    }
    setUploading(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api.post<{ url: string }>(
        `/uploads/image?folder=companies&company_id=${companyId}`,
        fd,
        { headers: { "Content-Type": "multipart/form-data" } }
      );
      onChange(r.data.url);
    } catch (e) {
      setErr(apiErrorMessage(e));
    } finally {
      setUploading(false);
    }
  };

  // CREATE mode — company doesn't exist yet, upload endpoint can't scope.
  // Show a friendly placeholder instead.
  if (mode === "create" || !companyId) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/60 p-4 text-center">
        <ImagePlus className="mx-auto mb-1.5 size-5 text-slate-400" />
        <p className="text-xs font-medium text-slate-700">
          {t("owner_companies.logo_after_create_title")}
        </p>
        <p className="mt-0.5 text-[11px] text-slate-500">
          {t("owner_companies.logo_after_create_hint")}
        </p>
      </div>
    );
  }

  // EDIT mode — actual uploader.
  const initials = (companyName || "??")
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div>
      <label className="label">{t("owner_companies.logo")}</label>
      <div className="flex flex-wrap items-center gap-4">
        <div
          className={cn(
            "relative flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-slate-50",
            value ? "border-slate-200" : "border-dashed border-slate-300"
          )}
        >
          {value ? (
            <img
              src={value}
              alt=""
              className="size-full object-contain"
              onError={() => setErr(t("owner_companies.logo_load_error"))}
            />
          ) : (
            <span className="text-xl font-bold text-slate-400">{initials}</span>
          )}
          {uploading && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/70">
              <Loader2 className="size-5 animate-spin text-brand-600" />
            </div>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              if (fileRef.current) fileRef.current.value = "";
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => fileRef.current?.click()}
              loading={uploading}
            >
              <Upload className="size-4" />
              {value
                ? t("owner_companies.logo_change")
                : t("owner_companies.logo_upload")}
            </Button>
            {value && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => onChange("")}
              >
                <Trash2 className="size-4" />
                {t("owner_companies.logo_remove")}
              </Button>
            )}
          </div>
          <p className="text-[11px] text-slate-500">
            {t("owner_companies.logo_format_hint")}
          </p>
          {err && <p className="text-[11px] text-rose-600">{err}</p>}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Visual plan picker (3 cards instead of dropdown).                   */
/* ------------------------------------------------------------------ */

function PlanPicker({
  value,
  onChange,
  labelFn,
}: {
  value: CompanyFormState["plan"];
  onChange: (p: CompanyFormState["plan"]) => void;
  labelFn: (p: string) => string;
}) {
  const { t } = useTranslation();
  const tones: Record<
    CompanyFormState["plan"],
    { ring: string; bg: string; text: string }
  > = {
    FREE: {
      ring: "ring-slate-300",
      bg: "bg-white",
      text: "text-slate-700",
    },
    PRO: {
      ring: "ring-brand-300",
      bg: "bg-brand-50/40",
      text: "text-brand-700",
    },
    ENTERPRISE: {
      ring: "ring-amber-300",
      bg: "bg-gradient-to-br from-amber-50 to-yellow-50",
      text: "text-amber-700",
    },
  };

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {PLAN_OPTS.map((p) => {
        const active = value === p;
        const ton = tones[p];
        return (
          <button
            type="button"
            key={p}
            onClick={() => onChange(p)}
            className={cn(
              "relative rounded-xl px-4 py-3 text-left ring-1 transition",
              ton.bg,
              active
                ? `${ton.ring} ring-2`
                : "ring-slate-200 hover:ring-slate-300"
            )}
          >
            <div className="flex items-center justify-between">
              <span className={cn("text-sm font-semibold", ton.text)}>
                {labelFn(p)}
              </span>
              {active && (
                <span className="size-2 rounded-full bg-brand-600 ring-2 ring-brand-200" />
              )}
            </div>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {t(`owner_companies.plan_${p.toLowerCase()}_hint`)}
            </p>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* "Subscription ends in X days" hint.                                 */
/* ------------------------------------------------------------------ */

function formatRemaining(
  date: string,
  t: ReturnType<typeof useTranslation>["t"]
): string {
  const d = new Date(date + "T00:00:00");
  if (Number.isNaN(d.getTime())) return "";
  const diff = Math.round((d.getTime() - Date.now()) / 86_400_000);
  if (diff < 0) return t("owner_companies.subscription_expired_ago", { days: -diff });
  if (diff === 0) return t("owner_companies.subscription_expires_today");
  return t("owner_companies.subscription_expires_in", { days: diff });
}
