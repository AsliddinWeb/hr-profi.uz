import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Layers } from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import {
  LeaveTypeForm,
  emptyLeaveTypeForm,
  leaveTypeFormToBody,
  leaveTypeToForm,
  type LeaveTypeFormValue,
} from "./LeaveTypeForm";
import type { LeaveType } from "@/lib/types";

export function LeaveTypeEditPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const [form, setForm] = useState<LeaveTypeFormValue>(emptyLeaveTypeForm);

  // The list endpoint is the only fetch path right now, so pluck the row out
  // of it. Cheap because the list is small and shared across the leaves hub.
  const typesQ = useQuery({
    queryKey: ["leave-types"],
    queryFn: async () => (await api.get<LeaveType[]>("/leave-types")).data,
  });
  const type = typesQ.data?.find((t) => t.id === id) ?? null;

  useEffect(() => {
    if (type) setForm(leaveTypeToForm(type));
  }, [type]);

  const mut = useMutation({
    mutationFn: async (f: LeaveTypeFormValue) =>
      (await api.patch<LeaveType>(`/leave-types/${id}`, leaveTypeFormToBody(f))).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leave-types"] });
      nav("/app/leaves?tab=types");
    },
  });

  if (typesQ.isLoading) {
    return <p className="text-sm text-slate-500">{t("common.loading")}</p>;
  }
  if (!type) {
    return <p className="text-sm text-red-600">{t("leaves.type_not_found") ?? "Not found"}</p>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("leaves.type_edit_title")}
        breadcrumbs={[
          { label: t("leaves.title"), to: "/app/leaves?tab=types" },
          { label: type.name },
        ]}
        icon={<Layers className="size-5" />}
      />

      <LeaveTypeForm
        value={form}
        onChange={setForm}
        onSubmit={() => mut.mutate(form)}
        onCancel={() => nav("/app/leaves?tab=types")}
        submitting={mut.isPending}
        submitLabel={t("common.save_changes")}
        errorMessage={mut.isError ? apiErrorMessage(mut.error) : null}
      />
    </div>
  );
}
