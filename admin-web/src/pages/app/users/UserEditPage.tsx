import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { KeyRound, Trash2, Users } from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/PageHeader";
import { useAuthStore } from "@/stores/auth";
import type { User } from "@/lib/types";

import { ResetPasswordDialog } from "./ResetPasswordDialog";
import { UserForm } from "./UserForm";
import { fromUser, type UserFormState } from "./utils";

export function UserEditPage() {
  const { id = "" } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const [resetOpen, setResetOpen] = useState(false);

  const userQ = useQuery({
    queryKey: ["users", id],
    queryFn: async () => (await api.get<User>(`/users/${id}`)).data,
    enabled: !!id,
  });

  const updateMut = useMutation({
    mutationFn: async (f: UserFormState) => {
      const body: Record<string, unknown> = {
        full_name: f.full_name || null,
        email: f.email || null,
        phone: f.phone || null,
        language: f.language,
        is_active: f.is_active,
        status: f.status,
      };
      if (f.role === "BRANCH_MANAGER" && f.branch_id) {
        body.branch_id = f.branch_id;
      }
      return (await api.patch<User>(`/users/${id}`, body)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      toast.success(t("common.save_changes"));
      nav("/app/users");
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const hardDeleteMut = useMutation({
    mutationFn: async () =>
      api.delete(`/users/${id}`, { params: { hard: true } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      toast.success(t("users_page.deleted_done"));
      nav("/app/users");
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  if (userQ.isLoading) {
    return <div className="p-6 text-sm text-slate-500">{t("common.loading")}</div>;
  }
  if (!userQ.data) {
    return (
      <div className="p-6 text-sm text-rose-600">
        {t("common.not_found")}
      </div>
    );
  }

  const u = userQ.data;
  const isSelf = me?.id === u.id;
  const isOwner = u.role === "OWNER";

  return (
    <div className="space-y-6">
      <PageHeader
        title={u.full_name || u.username}
        breadcrumbs={[
          { label: t("users_page.title"), to: "/app/users" },
          { label: u.full_name || u.username },
        ]}
        icon={<Users className="size-5" />}
        description={
          <span>
            <code className="font-mono text-xs">@{u.username}</code>
            {" · "}
            {u.role}
          </span>
        }
        actions={
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setResetOpen(true)}
            >
              <KeyRound className="size-4" />
              {t("users_page.reset_password")}
            </Button>
            {!isSelf && !isOwner && (
              <Button
                type="button"
                variant="danger"
                onClick={() => {
                  if (
                    window.confirm(
                      t("users_page.hard_delete_confirm", {
                        name: u.username,
                      }) ?? ""
                    )
                  ) {
                    hardDeleteMut.mutate();
                  }
                }}
                loading={hardDeleteMut.isPending}
              >
                <Trash2 className="size-4" />
                {t("users_page.hard_delete")}
              </Button>
            )}
          </div>
        }
      />

      <UserForm
        mode="edit"
        initial={fromUser(u)}
        selfEdit={isSelf}
        saving={updateMut.isPending}
        error={updateMut.error}
        onSubmit={async (f) => {
          await updateMut.mutateAsync(f);
        }}
        onCancel={() => nav("/app/users")}
      />

      {resetOpen && (
        <ResetPasswordDialog user={u} onClose={() => setResetOpen(false)} />
      )}
    </div>
  );
}
