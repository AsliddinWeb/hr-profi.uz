import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Save, User as UserIcon } from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useAuthStore } from "@/stores/auth";
import { useEnumLabel } from "@/lib/enum";
import type { User } from "@/lib/types";

import { ReadonlyField, Section } from "./components";

interface FormState {
  full_name: string;
  email: string;
  phone: string;
  language: "uz" | "ru" | "en";
}

export function ProfileTab() {
  const { t, i18n } = useTranslation();
  const label = useEnumLabel();
  const qc = useQueryClient();
  const setUser = useAuthStore((s) => s.setUser);

  const meQ = useQuery({
    queryKey: ["auth", "me"],
    queryFn: async () => (await api.get<User>("/auth/me")).data,
  });

  const [form, setForm] = useState<FormState | null>(null);
  if (meQ.data && form === null) {
    setForm({
      full_name: meQ.data.full_name ?? "",
      email: meQ.data.email ?? "",
      phone: meQ.data.phone ?? "",
      language: meQ.data.language,
    });
  }

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
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ["auth", "me"] });
      setUser(updated);
      // Mirror the language change into i18n right away.
      if (updated.language !== i18n.language) {
        void i18n.changeLanguage(updated.language);
      }
      toast.success(t("settings_page.saved"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  if (!form || !meQ.data) {
    return <p className="text-sm text-slate-500">{t("common.loading")}</p>;
  }

  const u = meQ.data;
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
      <Section
        title={t("settings_page.section_profile")}
        hint={t("settings_page.section_profile_hint")}
      >
        <Input
          label={t("settings_page.full_name")}
          value={form.full_name}
          onChange={(e) => update("full_name", e.target.value)}
          placeholder={t("users_page.full_name_placeholder") ?? ""}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            type="email"
            label={t("settings_page.email")}
            value={form.email}
            onChange={(e) => update("email", e.target.value)}
            placeholder="user@example.com"
          />
          <Input
            label={t("settings_page.phone")}
            value={form.phone}
            onChange={(e) => update("phone", e.target.value)}
            placeholder="+998 90 123 45 67"
          />
        </div>
        <div>
          <label className="label">{t("settings_page.my_language")}</label>
          <select
            className="input"
            value={form.language}
            onChange={(e) =>
              update("language", e.target.value as FormState["language"])
            }
          >
            <option value="uz">O'zbekcha</option>
            <option value="ru">Русский</option>
            <option value="en">English</option>
          </select>
          <p className="mt-1 text-[11px] text-slate-500">
            {t("settings_page.my_language_hint")}
          </p>
        </div>
      </Section>

      <Section
        title={t("settings_page.section_account_info")}
        hint={t("settings_page.section_account_info_hint")}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <ReadonlyField
            label={t("settings_page.username")}
            value={
              <span className="inline-flex items-center gap-1">
                <UserIcon className="size-3 text-slate-400" />
                <code className="font-mono text-xs">@{u.username}</code>
              </span>
            }
          />
          <ReadonlyField
            label={t("settings_page.role")}
            value={label("role", u.role)}
          />
          <ReadonlyField
            label={t("settings_page.created_at")}
            value={
              u.created_at
                ? new Date(u.created_at).toLocaleDateString(i18n.language)
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
