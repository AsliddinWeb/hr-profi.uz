import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Store } from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import {
  BranchForm,
  branchFormToBody,
  emptyBranchForm,
  type BranchFormValue,
} from "./BranchForm";
import type { Branch } from "@/lib/types";

export function BranchCreatePage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState<BranchFormValue>(emptyBranchForm);

  const createMut = useMutation({
    mutationFn: async (f: BranchFormValue) =>
      (await api.post<Branch>("/branches", branchFormToBody(f))).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["app", "branches"] });
      nav("/app/branches");
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("branches.create_title")}
        breadcrumbs={[
          { label: t("branches.title"), to: "/app/branches" },
          { label: t("branches.create_title") },
        ]}
        icon={<Store className="size-5" />}
        description={t("branches.create_subtitle")}
      />

      <BranchForm
        value={form}
        onChange={setForm}
        onSubmit={() => createMut.mutate(form)}
        onCancel={() => nav("/app/branches")}
        submitting={createMut.isPending}
        submitLabel={t("branches.create_submit")}
        errorMessage={createMut.isError ? apiErrorMessage(createMut.error) : null}
      />
    </div>
  );
}
