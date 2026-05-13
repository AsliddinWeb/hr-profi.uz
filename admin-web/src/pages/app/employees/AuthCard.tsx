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
      // Single endpoint covers create/update; for existing logins we
      // just pass the new password.
      await api.patch(`/employees/${employee.id}/login`, {
        password: newPassword,
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

  // Inline username rename — kept separate from the password dialog so
  // routine "fix a typo" edits don't open the more dramatic reset modal.
  const [renameDraft, setRenameDraft] = useState<string | null>(null);
  const renameMut = useMutation({
    mutationFn: async () => {
      if (renameDraft == null || !renameDraft.trim()) return;
      await api.patch(`/employees/${employee.id}/login`, {
        username: renameDraft.trim(),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users", employee.user_id] });
      setRenameDraft(null);
    },
  });

  const deactivateMut = useMutation({
    mutationFn: async () => {
      if (!employee.user_id) return;
      await api.patch(`/employees/${employee.id}/login`, { is_active: false });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users", employee.user_id] });
    },
  });

  const reactivateMut = useMutation({
    mutationFn: async () => {
      if (!employee.user_id) return;
      await api.patch(`/employees/${employee.id}/login`, { is_active: true });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users", employee.user_id] });
    },
  });

  // No login linked yet — surface the same create form here so the
  // admin can provision an account without going back to Create. The
  // ``PATCH /employees/{id}/login`` endpoint handles both create + update.
  if (!employee.user_id) {
    return (
      <CreateLoginCard
        employeeId={employee.id}
        onCreated={() => {
          // Refresh the page-level employees query so this card flips
          // into the "active login" state on next render.
          qc.invalidateQueries({ queryKey: ["employees", employee.id] });
          qc.invalidateQueries({ queryKey: ["employees"] });
        }}
      />
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
            {/* Username — editable inline; double-click or click the
                pencil to switch to an Input. Keeps the routine flow
                ("typo, fix it") out of the reset-password dialog. */}
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">
                {t("employees.login_username")}
              </div>
              {renameDraft == null ? (
                <div className="mt-0.5 flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-800">
                    {user?.username ?? "—"}
                  </span>
                  {isActive && user?.username && (
                    <button
                      type="button"
                      onClick={() => setRenameDraft(user.username)}
                      className="text-[11px] font-medium text-brand-600 hover:underline"
                    >
                      {t("common.edit")}
                    </button>
                  )}
                </div>
              ) : (
                <div className="mt-0.5 flex items-center gap-2">
                  <Input
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    autoCapitalize="none"
                    className="h-8 text-sm"
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => renameMut.mutate()}
                    loading={renameMut.isPending}
                    disabled={!renameDraft.trim()}
                  >
                    {t("common.save")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setRenameDraft(null)}
                    disabled={renameMut.isPending}
                  >
                    {t("common.cancel")}
                  </Button>
                </div>
              )}
              {renameMut.isError && (
                <p className="mt-1 text-[11px] text-red-600">
                  {apiErrorMessage(renameMut.error)}
                </p>
              )}
            </div>
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

/* ================================================================
 *  Provisioning UI — appears in the AuthCard slot when an employee
 *  has no linked User row. POSTs to ``PATCH /employees/{id}/login``
 *  with a fresh username + password; the backend creates the User,
 *  links it via ``employee.user_id``, and the page reloads.
 * ================================================================ */

function CreateLoginCard({
  employeeId,
  onCreated,
}: {
  employeeId: string;
  onCreated: () => void;
}) {
  const { t } = useTranslation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: async () => {
      setErr(null);
      if (!username.trim()) {
        throw new Error(t("employees.login_username_required"));
      }
      if (password.length < 8) {
        throw new Error(t("employees.password_min_length"));
      }
      if (password !== confirm) {
        throw new Error(t("employees.password_mismatch"));
      }
      await api.patch(`/employees/${employeeId}/login`, {
        username: username.trim(),
        password,
      });
    },
    onSuccess: () => {
      setUsername("");
      setPassword("");
      setConfirm("");
      onCreated();
    },
    onError: (e) => setErr(apiErrorMessage(e)),
  });

  return (
    <Card>
      <div className="space-y-4 p-6">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-7 items-center justify-center rounded-md bg-brand-50 text-brand-700">
            <KeyRound className="size-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-slate-700">
              {t("employees.section_login")}
            </h2>
            <p className="text-xs text-slate-500">
              {t("employees.section_login_hint")}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Input
            label={t("employees.login_username")}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoCapitalize="none"
            placeholder="asliddin.a"
          />
          <Input
            label={t("employees.login_password")}
            type="password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
          <Input
            label={t("employees.confirm_password")}
            type="password"
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="••••••••"
          />
        </div>

        {err && <p className="text-xs text-red-600">{err}</p>}

        <div className="flex justify-end">
          <Button
            type="button"
            onClick={() => createMut.mutate()}
            loading={createMut.isPending}
            disabled={!username || !password || !confirm}
          >
            <KeyRound className="size-4" />
            {t("employees.create_login_button")}
          </Button>
        </div>
      </div>
    </Card>
  );
}
