import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Users } from "lucide-react";

import { api } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import type { User } from "@/lib/types";

import { UserForm } from "./UserForm";
import { emptyUserForm, type UserFormState } from "./utils";

export function UserCreatePage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();

  const createMut = useMutation({
    mutationFn: async (f: UserFormState) => {
      const body: Record<string, unknown> = {
        username: f.username,
        password: f.password,
        role: f.role,
        language: f.language,
      };
      if (f.email) body.email = f.email;
      if (f.full_name) body.full_name = f.full_name;
      if (f.phone) body.phone = f.phone;
      if (f.role === "BRANCH_MANAGER" && f.branch_id) {
        body.branch_id = f.branch_id;
      }
      return (await api.post<User>("/users", body)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      toast.success(t("common.create"));
      nav("/app/users");
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("users_page.create_title")}
        breadcrumbs={[
          { label: t("users_page.title"), to: "/app/users" },
          { label: t("users_page.create_title") },
        ]}
        icon={<Users className="size-5" />}
        description={t("users_page.create_subtitle")}
      />

      <UserForm
        mode="create"
        initial={emptyUserForm}
        saving={createMut.isPending}
        error={createMut.error}
        onSubmit={async (f) => {
          await createMut.mutateAsync(f);
        }}
        onCancel={() => nav("/app/users")}
      />
    </div>
  );
}
