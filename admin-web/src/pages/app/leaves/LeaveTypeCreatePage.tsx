import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Layers } from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import {
  LeaveTypeForm,
  emptyLeaveTypeForm,
  leaveTypeFormToBody,
  type LeaveTypeFormValue,
} from "./LeaveTypeForm";
import type { LeaveType } from "@/lib/types";

export function LeaveTypeCreatePage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState<LeaveTypeFormValue>(emptyLeaveTypeForm);

  const mut = useMutation({
    mutationFn: async (f: LeaveTypeFormValue) =>
      (await api.post<LeaveType>("/leave-types", leaveTypeFormToBody(f))).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leave-types"] });
      nav("/app/leaves?tab=types");
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("leaves.type_create_title")}
        breadcrumbs={[
          { label: t("leaves.title"), to: "/app/leaves?tab=types" },
          { label: t("leaves.type_create_title") },
        ]}
        icon={<Layers className="size-5" />}
        description={t("leaves.type_create_subtitle")}
      />

      <LeaveTypeForm
        value={form}
        onChange={setForm}
        onSubmit={() => mut.mutate(form)}
        onCancel={() => nav("/app/leaves?tab=types")}
        submitting={mut.isPending}
        submitLabel={t("leaves.add_type")}
        errorMessage={mut.isError ? apiErrorMessage(mut.error) : null}
      />
    </div>
  );
}
