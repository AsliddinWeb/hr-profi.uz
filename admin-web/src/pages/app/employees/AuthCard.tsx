import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Lock,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dialog, DialogFooter } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import type { Employee, User } from "@/lib/types";

interface Props {
  employee: Employee;
}

export function AuthCard({ employee }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const userQ = useQuery({
    queryKey: ["users", employee.user_id],
    queryFn: async () =>
      (await api.get<User>(`/users/${employee.user_id}`)).data,
    enabled: !!employee.user_id,
  });

  const [resetOpen, setResetOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);

  const resetMut = useMutation({
    mutationFn: async () => {
      if (!employee.user_id) throw new Error("no user_id");
      if (newPassword.length < 8) {
        throw new Error(t("employees.password_min_length") ?? "Min 8 chars");
      }
      if (newPassword !== confirmPassword) {
        throw new Error(t("employees.password_mismatch") ?? "Mismatch");
      }
      await api.post(`/users/${employee.user_id}/reset-password`, {
        user_id: employee.user_id,
        new_password: newPassword,
      });
    },
    onSuccess: () => {
      setResetOpen(false);
      setNewPassword("");
      setConfirmPassword("");
      setPwError(null);
    },
    onError: (err) => {
      setPwError(apiErrorMessage(err));
    },
  });

  const deactivateMut = useMutation({
    mutationFn: async () => {
      if (!employee.user_id) return;
      await api.delete(`/users/${employee.user_id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users", employee.user_id] });
    },
  });

  const reactivateMut = useMutation({
    mutationFn: async () => {
      if (!employee.user_id) return;
      await api.patch(`/users/${employee.user_id}`, { is_active: true });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users", employee.user_id] });
    },
  });

  // No login linked yet — point the admin to the Create flow's login section
  // (we don't provision a User from Edit, since that flow is multi-step and
  // collides with the existing employee_service create path).
  if (!employee.user_id) {
    return (
      <Card>
        <div className="space-y-3 p-6">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex size-7 items-center justify-center rounded-md bg-slate-100 text-slate-500">
              <KeyRound className="size-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-slate-700">
                {t("employees.section_login")}
              </h2>
              <p className="text-xs text-slate-500">{t("employees.no_login_linked")}</p>
            </div>
          </div>
        </div>
      </Card>
    );
  }

  const user = userQ.data;
  const isActive = user?.is_active ?? false;

  return (
    <Card>
      <div className="space-y-4 p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "mt-0.5 flex size-7 items-center justify-center rounded-md",
                isActive ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
              )}
            >
              <KeyRound className="size-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-slate-700">
                {t("employees.section_login")}
              </h2>
              <p className="text-xs text-slate-500">
                {t("employees.section_login_active_hint")}
              </p>
            </div>
          </div>
          <Badge tone={isActive ? "success" : "danger"}>
            {isActive ? t("common.active") : t("common.inactive")}
          </Badge>
        </div>

        {userQ.isLoading ? (
          <p className="text-sm text-slate-500">{t("common.loading")}</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-3">
            <Field
              label={t("employees.login_username")}
              value={user?.username ?? "—"}
            />
            <Field label={t("employees.email")} value={user?.email ?? "—"} />
            <Field
              label={t("employees.last_login")}
              value={
                user?.updated_at
                  ? new Date(user.updated_at).toLocaleDateString()
                  : "—"
              }
            />
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setResetOpen(true)}
            disabled={!isActive}
          >
            <Lock className="size-4" />
            {t("employees.reset_password")}
          </Button>
          {isActive ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                if (window.confirm(t("employees.deactivate_confirm") || "Deactivate?")) {
                  deactivateMut.mutate();
                }
              }}
              loading={deactivateMut.isPending}
            >
              <ShieldOff className="size-4" />
              {t("employees.deactivate_login")}
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              onClick={() => reactivateMut.mutate()}
              loading={reactivateMut.isPending}
            >
              <ShieldCheck className="size-4" />
              {t("employees.reactivate_login")}
            </Button>
          )}
        </div>

        {(deactivateMut.isError || reactivateMut.isError) && (
          <p className="text-xs text-red-600">
            {apiErrorMessage(deactivateMut.error || reactivateMut.error)}
          </p>
        )}
      </div>

      <Dialog
        open={resetOpen}
        onClose={() => {
          setResetOpen(false);
          setNewPassword("");
          setConfirmPassword("");
          setPwError(null);
        }}
        title={t("employees.reset_password")}
      >
        <div className="space-y-4">
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <p>{t("employees.reset_password_warning")}</p>
          </div>
          <Input
            label={t("employees.new_password")}
            type="password"
            minLength={8}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoFocus
          />
          <Input
            label={t("employees.confirm_password")}
            type="password"
            minLength={8}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
          {pwError && <p className="text-xs text-red-600">{pwError}</p>}
          {resetMut.isSuccess && (
            <p className="inline-flex items-center gap-1 text-xs text-emerald-700">
              <CheckCircle2 className="size-3.5" /> {t("employees.password_reset_ok")}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setResetOpen(false);
                setNewPassword("");
                setConfirmPassword("");
                setPwError(null);
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => resetMut.mutate()}
              loading={resetMut.isPending}
            >
              {t("employees.reset_password")}
            </Button>
          </DialogFooter>
        </div>
      </Dialog>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 text-sm font-medium text-slate-800">{value}</div>
    </div>
  );
}
