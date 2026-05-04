import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import {
  EmployeeForm,
  emptyEmployeeForm,
  employeeFormToUpdate,
  employeeToForm,
  type EmployeeFormValue,
} from "./EmployeeForm";
import { LiveEarningsCard } from "./LiveEarningsCard";
import { AuthCard } from "./AuthCard";
import { BonusesDeductionsCard } from "./BonusesDeductionsCard";
import type { Employee } from "@/lib/types";

export function EmployeeEditPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const [form, setForm] = useState<EmployeeFormValue>(emptyEmployeeForm);

  const employeeQ = useQuery({
    queryKey: ["employees", id],
    queryFn: async () => (await api.get<Employee>(`/employees/${id}`)).data,
    enabled: !!id,
  });

  useEffect(() => {
    if (employeeQ.data) setForm(employeeToForm(employeeQ.data));
  }, [employeeQ.data]);

  const updateMut = useMutation({
    mutationFn: async (f: EmployeeFormValue) =>
      (await api.patch<Employee>(`/employees/${id}`, employeeFormToUpdate(f))).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["employees", id] });
      nav("/app/employees");
    },
  });

  if (employeeQ.isLoading) {
    return <p className="text-sm text-slate-500">{t("common.loading")}</p>;
  }
  if (employeeQ.isError) {
    return <p className="text-sm text-red-600">{apiErrorMessage(employeeQ.error)}</p>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("employees.edit_title")}
        breadcrumbs={[
          { label: t("employees.title"), to: "/app/employees" },
          { label: employeeQ.data?.full_name ?? t("employees.edit_title") },
        ]}
        icon={<Users className="size-5" />}
        description={
          employeeQ.data?.position && employeeQ.data?.employee_code
            ? `${employeeQ.data.position} · ${employeeQ.data.employee_code}`
            : undefined
        }
      />

      {employeeQ.data && (
        <>
          <LiveEarningsCard employee={employeeQ.data} />
          <BonusesDeductionsCard employee={employeeQ.data} />
          <AuthCard employee={employeeQ.data} />
        </>
      )}

      <EmployeeForm
        value={form}
        onChange={setForm}
        onSubmit={() => updateMut.mutate(form)}
        onCancel={() => nav("/app/employees")}
        submitting={updateMut.isPending}
        submitLabel={t("common.save_changes")}
        errorMessage={updateMut.isError ? apiErrorMessage(updateMut.error) : null}
        editingId={id}
      />
    </div>
  );
}
