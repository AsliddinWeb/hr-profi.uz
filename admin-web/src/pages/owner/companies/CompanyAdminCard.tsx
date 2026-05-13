import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Eye, EyeOff, KeyRound, UserCog } from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { User } from "@/lib/types";

/* Owner-only section on the Company Edit page: lets the OWNER patch
 * the tenant's super-admin (COMPANY_ADMIN) directly without having to
 * impersonate / log in as that company. Username stays read-only —
 * usernames are immutable across the codebase to keep the
 * (company_id, username) unique key + JWT semantics stable. */

interface AdminForm {
  full_name: string;
  email: string;
  phone: string;
  language: "uz" | "ru" | "en";
  is_active: boolean;
  password: string;
}

export function CompanyAdminCard({ companyId }: { companyId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const adminQ = useQuery({
    queryKey: ["owner", "companies", companyId, "admin"],
    queryFn: async () =>
      (await api.get<User>(`/owner/companies/${companyId}/admin`)).data,
    retry: 1,
  });

  const [form, setForm] = useState<AdminForm>({
    full_name: "",
    email: "",
    phone: "",
    language: "uz",
    is_active: true,
    password: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Hydrate the form once the admin lands. We deliberately don't
  // re-hydrate on refetch — that would clobber in-progress edits.
  useEffect(() => {
    if (!adminQ.data || dirty) return;
    setForm({
      full_name: adminQ.data.full_name ?? "",
      email: adminQ.data.email ?? "",
      phone: adminQ.data.phone ?? "",
      language: adminQ.data.language ?? "uz",
      is_active: adminQ.data.is_active,
      password: "",
    });
  }, [adminQ.data, dirty]);

  const update = <K extends keyof AdminForm>(key: K, value: AdminForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      // Guard against the 422 round-trip — give instant feedback if
      // the operator typed a short password before submitting.
      if (form.password && form.password.length < 8) {
        throw new Error(t("owner_companies.admin_password_too_short"));
      }
      const body: Record<string, unknown> = {
        full_name: form.full_name || null,
        email: form.email || null,
        phone: form.phone || null,
        language: form.language,
        is_active: form.is_active,
      };
      if (form.password) {
        body.password = form.password;
      }
      return (
        await api.patch<User>(`/owner/companies/${companyId}/admin`, body)
      ).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["owner", "companies", companyId, "admin"],
      });
      setDirty(false);
      setForm((f) => ({ ...f, password: "" }));
      toast.success(t("owner_companies.admin_saved"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  if (adminQ.isLoading) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="text-sm text-slate-500">{t("common.loading")}</p>
      </section>
    );
  }
  if (!adminQ.data) {
    return (
      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
        {t("owner_companies.admin_not_found")}
      </section>
    );
  }

  const admin = adminQ.data;

  return (
    <section className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50/60 to-white p-5">
      <header className="mb-4 flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
          <UserCog className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold text-slate-900">
            {t("owner_companies.admin_section_title")}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {t("owner_companies.admin_section_hint")}
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Username — read-only */}
        <Input
          label={t("owner_companies.admin_username")}
          value={admin.username}
          readOnly
          disabled
          hint={t("owner_companies.admin_username_readonly_hint") ?? undefined}
        />

        <Input
          label={t("owner_companies.admin_full_name")}
          value={form.full_name}
          onChange={(e) => update("full_name", e.target.value)}
          placeholder="Asliddin Abdujabborov"
        />

        <Input
          type="email"
          label={t("owner_companies.admin_email")}
          value={form.email}
          onChange={(e) => update("email", e.target.value)}
          placeholder="admin@example.com"
        />

        <Input
          label={t("owner_companies.admin_phone")}
          value={form.phone}
          onChange={(e) => update("phone", e.target.value)}
          placeholder="+998 90 123 45 67"
        />

        <div>
          <label className="label">{t("owner_companies.admin_language")}</label>
          <select
            className="input"
            value={form.language}
            onChange={(e) =>
              update("language", e.target.value as AdminForm["language"])
            }
          >
            <option value="uz">O'zbek</option>
            <option value="ru">Русский</option>
            <option value="en">English</option>
          </select>
        </div>

        <div>
          <label className="label">{t("owner_companies.admin_status")}</label>
          <label className="mt-2 inline-flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => update("is_active", e.target.checked)}
              className="size-4 rounded border-slate-300"
            />
            <span className={form.is_active ? "text-emerald-700" : "text-rose-700"}>
              {form.is_active
                ? t("owner_companies.admin_is_active")
                : t("owner_companies.admin_is_inactive")}
            </span>
          </label>
        </div>
      </div>

      {/* Password reset — separate row, hidden by default to keep the
          UX safe (no accidental rotation from autofill). */}
      <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <KeyRound className="size-4 text-slate-500" />
          {t("owner_companies.admin_reset_password")}
        </div>
        <p className="mt-0.5 text-[11px] text-slate-500">
          {t("owner_companies.admin_reset_password_hint")}
        </p>
        <div className="mt-3 flex items-end gap-2">
          <div className="relative flex-1">
            <Input
              type={showPassword ? "text" : "password"}
              label={t("owner_companies.admin_new_password")}
              value={form.password}
              onChange={(e) => update("password", e.target.value)}
              placeholder="••••••••"
              minLength={8}
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="absolute inset-y-0 right-0 top-6 flex items-center pr-3 text-slate-400 hover:text-slate-700"
              tabIndex={-1}
            >
              {showPassword ? (
                <EyeOff className="size-4" />
              ) : (
                <Eye className="size-4" />
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            // Snap back to server state.
            setDirty(false);
            setForm({
              full_name: admin.full_name ?? "",
              email: admin.email ?? "",
              phone: admin.phone ?? "",
              language: admin.language ?? "uz",
              is_active: admin.is_active,
              password: "",
            });
          }}
          disabled={!dirty || saveMut.isPending}
        >
          {t("common.cancel")}
        </Button>
        <Button
          type="button"
          onClick={() => saveMut.mutate()}
          loading={saveMut.isPending}
          disabled={!dirty}
        >
          {t("common.save_changes")}
        </Button>
      </div>
    </section>
  );
}
