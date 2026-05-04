import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { KeyRound, ShieldAlert } from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

import { Section } from "./components";

export function SecurityTab() {
  const { t } = useTranslation();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  const mut = useMutation({
    mutationFn: async () =>
      api.post("/auth/password/change", {
        current_password: current,
        new_password: next,
      }),
    onSuccess: () => {
      toast.success(t("settings_page.password_changed"));
      setCurrent("");
      setNext("");
      setConfirm("");
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const valid = next.length >= 8 && next === confirm && current.length > 0;

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (next !== confirm) {
          toast.error(t("settings_page.password_mismatch") ?? "");
          return;
        }
        if (next.length < 8) {
          toast.error(t("users_page.password_too_short") ?? "");
          return;
        }
        mut.mutate();
      }}
    >
      <Section
        title={t("settings_page.section_password")}
        hint={t("settings_page.section_password_hint")}
      >
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <p>{t("settings_page.password_revoke_hint")}</p>
        </div>

        <Input
          type="password"
          label={t("settings_page.current_password") + " *"}
          required
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            type="password"
            label={t("settings_page.new_password") + " *"}
            required
            minLength={8}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            hint={t("users_page.password_hint") ?? undefined}
          />
          <Input
            type="password"
            label={t("settings_page.confirm_password") + " *"}
            required
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            error={
              confirm && confirm !== next
                ? (t("settings_page.password_mismatch") ?? "Mismatch")
                : undefined
            }
          />
        </div>
      </Section>

      <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
        <Button type="submit" disabled={!valid} loading={mut.isPending}>
          <KeyRound className="size-4" />
          {t("settings_page.change_password")}
        </Button>
      </div>
    </form>
  );
}
