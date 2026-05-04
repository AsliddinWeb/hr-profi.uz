import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Network } from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import {
  DepartmentForm,
  departmentFormToUpdate,
  departmentToForm,
  emptyDepartmentForm,
  type DepartmentFormValue,
} from "./DepartmentForm";
import type { Department } from "@/lib/types";

export function DepartmentEditPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const [form, setForm] = useState<DepartmentFormValue>(emptyDepartmentForm);

  const deptQ = useQuery({
    queryKey: ["departments", id],
    queryFn: async () => (await api.get<Department>(`/departments/${id}`)).data,
    enabled: !!id,
  });

  useEffect(() => {
    if (deptQ.data) setForm(departmentToForm(deptQ.data));
  }, [deptQ.data]);

  const updateMut = useMutation({
    mutationFn: async (f: DepartmentFormValue) =>
      (await api.patch<Department>(`/departments/${id}`, departmentFormToUpdate(f))).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["departments"] });
      qc.invalidateQueries({ queryKey: ["departments", "for-dept-form"] });
      nav("/app/departments");
    },
  });

  if (deptQ.isLoading) {
    return <p className="text-sm text-slate-500">{t("common.loading")}</p>;
  }
  if (deptQ.isError) {
    return <p className="text-sm text-red-600">{apiErrorMessage(deptQ.error)}</p>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("departments_page.edit_title")}
        breadcrumbs={[
          { label: t("departments_page.title"), to: "/app/departments" },
          { label: deptQ.data?.name ?? t("departments_page.edit_title") },
        ]}
        icon={<Network className="size-5" />}
      />

      <DepartmentForm
        value={form}
        onChange={setForm}
        onSubmit={() => updateMut.mutate(form)}
        onCancel={() => nav("/app/departments")}
        submitting={updateMut.isPending}
        submitLabel={t("common.save_changes")}
        errorMessage={updateMut.isError ? apiErrorMessage(updateMut.error) : null}
        editingId={id}
      />
    </div>
  );
}
