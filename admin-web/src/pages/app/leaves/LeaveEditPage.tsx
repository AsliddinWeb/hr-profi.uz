import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CalendarDays } from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { LeaveForm, emptyLeaveForm, type LeaveFormValue } from "./LeaveForm";
import type { LeaveRequest } from "@/lib/types";

export function LeaveEditPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const [form, setForm] = useState<LeaveFormValue>(emptyLeaveForm);

  const reqQ = useQuery({
    queryKey: ["leave-requests", id],
    queryFn: async () => (await api.get<LeaveRequest>(`/leave-requests/${id}`)).data,
    enabled: !!id,
  });

  // Hydrate form once on load. Override is rendered as the stored numeric
  // string ("250000.00" → "250000.00"); a blank string in form means "use
  // the auto-calculated amount".
  useEffect(() => {
    if (!reqQ.data) return;
    setForm({
      employee_id: reqQ.data.employee_id,
      leave_type_id: reqQ.data.leave_type_id,
      start_date: reqQ.data.start_date,
      end_date: reqQ.data.end_date,
      reason: reqQ.data.reason ?? "",
      decision_note: reqQ.data.decision_note ?? "",
      auto_approve: false, // not used in edit; lock to false
      override_amount: reqQ.data.override_amount ?? "",
    });
  }, [reqQ.data]);

  const mut = useMutation({
    mutationFn: async (f: LeaveFormValue) =>
      (
        await api.patch<LeaveRequest>(`/leave-requests/${id}`, {
          override_amount: f.override_amount ? Number(f.override_amount) : null,
          decision_note: f.decision_note.trim() || null,
          reason: f.reason.trim() || null,
        })
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leave-requests"] });
      qc.invalidateQueries({ queryKey: ["leave-balances"] });
      qc.invalidateQueries({ queryKey: ["salary"] });
      nav("/app/leaves");
    },
  });

  if (reqQ.isLoading) {
    return <p className="text-sm text-slate-500">{t("common.loading")}</p>;
  }
  if (reqQ.isError) {
    return <p className="text-sm text-red-600">{apiErrorMessage(reqQ.error)}</p>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("leaves.edit_title")}
        breadcrumbs={[
          { label: t("leaves.title"), to: "/app/leaves" },
          { label: t("leaves.edit_title") },
        ]}
        icon={<CalendarDays className="size-5" />}
        description={t("leaves.edit_subtitle")}
      />

      <LeaveForm
        value={form}
        onChange={setForm}
        onSubmit={() => mut.mutate(form)}
        onCancel={() => nav("/app/leaves")}
        submitting={mut.isPending}
        submitLabel={t("common.save_changes")}
        errorMessage={mut.isError ? apiErrorMessage(mut.error) : null}
        isEdit
      />
    </div>
  );
}
