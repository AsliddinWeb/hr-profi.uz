import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Network } from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import {
  DepartmentForm,
  departmentFormToCreate,
  emptyDepartmentForm,
  type DepartmentFormValue,
} from "./DepartmentForm";
import type { Department } from "@/lib/types";

export function DepartmentCreatePage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();

  // Allow ?branch_id=… so e.g. the BranchEdit page can deep-link "Add a
  // department under this branch".
  const [form, setForm] = useState<DepartmentFormValue>({
    ...emptyDepartmentForm,
    branch_id: params.get("branch_id") ?? "",
    parent_id: params.get("parent_id") ?? "",
  });

  const createMut = useMutation({
    mutationFn: async (f: DepartmentFormValue) =>
      (await api.post<Department>("/departments", departmentFormToCreate(f))).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["departments"] });
      qc.invalidateQueries({ queryKey: ["departments", "for-dept-form"] });
      nav("/app/departments");
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("departments_page.create_title")}
        breadcrumbs={[
          { label: t("departments_page.title"), to: "/app/departments" },
          { label: t("departments_page.create_title") },
        ]}
        icon={<Network className="size-5" />}
        description={t("departments_page.create_subtitle")}
      />

      <DepartmentForm
        value={form}
        onChange={setForm}
        onSubmit={() => createMut.mutate(form)}
        onCancel={() => nav("/app/departments")}
        submitting={createMut.isPending}
        submitLabel={t("departments_page.create_submit")}
        errorMessage={createMut.isError ? apiErrorMessage(createMut.error) : null}
      />
    </div>
  );
}
