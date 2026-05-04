import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Save } from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useEnumLabel } from "@/lib/enum";
import type { Branch, Role, UserStatus } from "@/lib/types";

import { CREATABLE_ROLES, type UserFormState } from "./utils";

type Mode = "create" | "edit";

const STATUS_OPTS: UserStatus[] = ["ACTIVE", "INVITED", "SUSPENDED", "TERMINATED"];

export function UserForm({
  mode,
  initial,
  onSubmit,
  onCancel,
  saving,
  error,
  /** When true, status/is_active fields are read-only (admin editing themselves). */
  selfEdit,
}: {
  mode: Mode;
  initial: UserFormState;
  onSubmit: (state: UserFormState) => Promise<void> | void;
  onCancel: () => void;
  saving?: boolean;
  error?: unknown;
  selfEdit?: boolean;
}) {
  const { t } = useTranslation();
  const label = useEnumLabel();
  const [form, setForm] = useState<UserFormState>(initial);

  // Only fetched when the role picker actually has BRANCH_MANAGER selected,
  // so other admins/HR creates don't pay the round-trip.
  const branchesQ = useQuery({
    queryKey: ["branches", "list", "for-user-form"],
    queryFn: async () => (await api.get<Branch[]>("/branches")).data,
    enabled: form.role === "BRANCH_MANAGER",
    staleTime: 5 * 60_000,
  });

  const update = <K extends keyof UserFormState>(
    k: K,
    v: UserFormState[K]
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
        title={t("users_page.section_identity")}
        hint={t("users_page.section_identity_hint")}
      >
        <Input
          label={t("users_page.username") + " *"}
          required
          value={form.username}
          onChange={(e) => update("username", e.target.value)}
          disabled={mode === "edit"}
          hint={
            mode === "edit"
              ? t("users_page.username_locked_hint") ?? undefined
              : undefined
          }
          placeholder="hr_manager_01"
          autoComplete="off"
        />
        <Input
          label={t("users_page.full_name")}
          value={form.full_name}
          onChange={(e) => update("full_name", e.target.value)}
          placeholder={t("users_page.full_name_placeholder") ?? ""}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            type="email"
            label={t("users_page.email")}
            value={form.email}
            onChange={(e) => update("email", e.target.value)}
            placeholder="user@example.com"
            autoComplete="off"
          />
          <Input
            label={t("users_page.phone")}
            value={form.phone}
            onChange={(e) => update("phone", e.target.value)}
            placeholder="+998 90 123 45 67"
            autoComplete="off"
          />
        </div>
      </Section>

      {/* Access */}
      <Section
        title={t("users_page.section_access")}
        hint={t("users_page.section_access_hint")}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">{t("users_page.role") + " *"}</label>
            <select
              className="input"
              value={form.role}
              onChange={(e) => update("role", e.target.value as Role)}
              disabled={mode === "edit" || selfEdit}
            >
              {CREATABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {label("role", r)}
                </option>
              ))}
            </select>
            {(mode === "edit" || selfEdit) && (
              <p className="mt-1 text-[11px] text-slate-400">
                {selfEdit
                  ? t("users_page.role_self_locked_hint")
                  : t("users_page.role_locked_hint")}
              </p>
            )}
          </div>
          <div>
            <label className="label">{t("users_page.language")}</label>
            <select
              className="input"
              value={form.language}
              onChange={(e) =>
                update("language", e.target.value as UserFormState["language"])
              }
            >
              <option value="uz">O'zbekcha</option>
              <option value="ru">Русский</option>
              <option value="en">English</option>
            </select>
          </div>
        </div>
        {form.role === "BRANCH_MANAGER" && (
          <div>
            <label className="label">
              {t("users_page.branch") + " *"}
            </label>
            <select
              className="input"
              required
              value={form.branch_id}
              onChange={(e) => update("branch_id", e.target.value)}
            >
              <option value="" disabled>
                {branchesQ.isLoading
                  ? t("common.loading")
                  : t("users_page.branch_choose")}
              </option>
              {(branchesQ.data ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-slate-500">
              {t("users_page.branch_hint")}
            </p>
          </div>
        )}
        {mode === "create" && (
          <Input
            type="password"
            label={t("users_page.password") + " *"}
            required
            value={form.password}
            onChange={(e) => update("password", e.target.value)}
            placeholder="••••••••"
            hint={t("users_page.password_hint") ?? undefined}
            autoComplete="new-password"
          />
        )}
      </Section>

      {/* Lifecycle (edit only) */}
      {mode === "edit" && (
        <Section
          title={t("users_page.section_lifecycle")}
          hint={t("users_page.section_lifecycle_hint")}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label">{t("users_page.user_status")}</label>
              <select
                className="input"
                value={form.status}
                onChange={(e) =>
                  update("status", e.target.value as UserStatus)
                }
                disabled={selfEdit}
              >
                {STATUS_OPTS.map((s) => (
                  <option key={s} value={s}>
                    {label("user_status", s)}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 pt-7 text-sm text-slate-700">
              <input
                type="checkbox"
                className="size-4"
                checked={form.is_active}
                onChange={(e) => update("is_active", e.target.checked)}
                disabled={selfEdit}
              />
              <span>
                <span className="font-semibold">
                  {t("users_page.is_active_label")}
                </span>
                <span className="ml-2 text-[11px] text-slate-500">
                  {form.is_active
                    ? t("users_page.is_active_on_hint")
                    : t("users_page.is_active_off_hint")}
                </span>
              </span>
            </label>
          </div>
          {selfEdit && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {t("users_page.self_edit_hint")}
            </p>
          )}
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
