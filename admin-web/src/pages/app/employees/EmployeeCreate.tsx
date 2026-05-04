import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import {
  EmployeeForm,
  emptyEmployeeForm,
  employeeFormToCreate,
  type EmployeeFormValue,
} from "./EmployeeForm";
import type { Employee } from "@/lib/types";

export function EmployeeCreatePage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState<EmployeeFormValue>(emptyEmployeeForm);

  // Pre-fill `employee_code` with the next E-NNN suggested by the server. Done
  // on mount and not memoised so a user who lands on this page after creating
  // someone else gets a fresh number.
  const nextCodeQ = useQuery({
    queryKey: ["employees", "next-code"],
    queryFn: async () =>
      (await api.get<{ code: string }>("/employees/next-code")).data,
    refetchOnWindowFocus: false,
    staleTime: 0,
  });

  useEffect(() => {
    if (nextCodeQ.data?.code && !form.employee_code) {
      setForm((f) => ({ ...f, employee_code: nextCodeQ.data!.code }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextCodeQ.data?.code]);

  const createMut = useMutation({
    mutationFn: async (f: EmployeeFormValue) =>
      (await api.post<Employee>("/employees", employeeFormToCreate(f))).data,
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["employees", "next-code"] });
      // Land directly on the new employee's edit page so the admin can wire
      // up the schedule and see the live earnings widget.
      nav(`/app/employees/${created.id}/edit`);
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("employees.create_title")}
        breadcrumbs={[
          { label: t("employees.title"), to: "/app/employees" },
          { label: t("employees.create_title") },
        ]}
        icon={<Users className="size-5" />}
        description={t("employees.create_subtitle")}
      />

      <EmployeeForm
        value={form}
        onChange={setForm}
        onSubmit={() => createMut.mutate(form)}
        onCancel={() => nav("/app/employees")}
        submitting={createMut.isPending}
        submitLabel={t("employees.create_submit")}
        errorMessage={createMut.isError ? apiErrorMessage(createMut.error) : null}
      />
    </div>
  );
}
