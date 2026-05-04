import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogFooter } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import type { User } from "@/lib/types";

export function ResetPasswordDialog({
  user,
  onClose,
}: {
  user: User;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [pwd, setPwd] = useState("");

  const mut = useMutation({
    mutationFn: async () =>
      api.post(`/users/${user.id}/reset-password`, {
        user_id: user.id,
        new_password: pwd,
      }),
    onSuccess: () => {
      toast.success(t("users_page.reset_password_done"));
      onClose();
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={`${t("users_page.reset_password")} — ${user.username}`}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (pwd.length < 8) {
            toast.error(t("users_page.password_too_short") ?? "");
            return;
          }
          mut.mutate();
        }}
      >
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <KeyRound className="mt-0.5 size-4 shrink-0" />
          <p>{t("users_page.reset_password_hint")}</p>
        </div>
        <Input
          type="password"
          label={t("users_page.new_password") + " *"}
          required
          minLength={8}
          value={pwd}
          onChange={(e) => setPwd(e.target.value)}
          placeholder="••••••••"
          autoComplete="new-password"
          hint={t("users_page.password_hint") ?? undefined}
        />

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" loading={mut.isPending}>
            <KeyRound className="size-4" />
            {t("users_page.reset_password")}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
