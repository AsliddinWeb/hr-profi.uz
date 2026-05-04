import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CalendarDays } from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { LeaveForm, emptyLeaveForm, type LeaveFormValue } from "./LeaveForm";
import type { LeaveRequest } from "@/lib/types";

export function LeaveCreatePage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState<LeaveFormValue>(emptyLeaveForm);

  const mut = useMutation({
    mutationFn: async (f: LeaveFormValue) =>
      (
        await api.post<LeaveRequest>("/leave-requests/admin", {
          employee_id: f.employee_id,
          leave_type_id: f.leave_type_id,
          start_date: f.start_date,
          end_date: f.end_date,
          reason: f.reason.trim() || null,
          decision_note: f.decision_note.trim() || null,
          auto_approve: f.auto_approve,
          override_amount: f.override_amount ? Number(f.override_amount) : null,
        })
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leave-requests"] });
      qc.invalidateQueries({ queryKey: ["leave-balances"] });
      qc.invalidateQueries({ queryKey: ["salary"] });
      nav("/app/leaves");
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("leaves.create_admin_title")}
        breadcrumbs={[
          { label: t("leaves.title"), to: "/app/leaves" },
          { label: t("leaves.create_admin_title") },
        ]}
        icon={<CalendarDays className="size-5" />}
        description={t("leaves.create_admin_subtitle")}
      />

      <LeaveForm
        value={form}
        onChange={setForm}
        onSubmit={() => mut.mutate(form)}
        onCancel={() => nav("/app/leaves")}
        submitting={mut.isPending}
        submitLabel={t("leaves.create_admin_short")}
        errorMessage={mut.isError ? apiErrorMessage(mut.error) : null}
      />
    </div>
  );
}
