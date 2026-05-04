import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Store } from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import {
  BranchForm,
  branchFormToBody,
  branchToForm,
  emptyBranchForm,
  type BranchFormValue,
} from "./BranchForm";
import type { Branch } from "@/lib/types";

export function BranchEditPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const [form, setForm] = useState<BranchFormValue>(emptyBranchForm);

  const branchQ = useQuery({
    queryKey: ["app", "branches", id],
    queryFn: async () => (await api.get<Branch>(`/branches/${id}`)).data,
    enabled: !!id,
  });

  // Hydrate the form once the branch lands.
  useEffect(() => {
    if (branchQ.data) setForm(branchToForm(branchQ.data));
  }, [branchQ.data]);

  const updateMut = useMutation({
    mutationFn: async (f: BranchFormValue) =>
      (await api.patch<Branch>(`/branches/${id}`, branchFormToBody(f))).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["app", "branches"] });
      nav("/app/branches");
    },
  });

  if (branchQ.isLoading) {
    return <p className="text-sm text-slate-500">{t("common.loading")}</p>;
  }

  if (branchQ.isError) {
    return (
      <p className="text-sm text-red-600">{apiErrorMessage(branchQ.error)}</p>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("branches.edit_title")}
        breadcrumbs={[
          { label: t("branches.title"), to: "/app/branches" },
          { label: branchQ.data?.name ?? t("branches.edit_title") },
        ]}
        icon={<Store className="size-5" />}
      />

      <BranchForm
        value={form}
        onChange={setForm}
        onSubmit={() => updateMut.mutate(form)}
        onCancel={() => nav("/app/branches")}
        submitting={updateMut.isPending}
        submitLabel={t("common.save_changes")}
        errorMessage={updateMut.isError ? apiErrorMessage(updateMut.error) : null}
      />
    </div>
  );
}
