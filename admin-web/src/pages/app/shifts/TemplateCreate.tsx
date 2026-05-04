import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Calendar } from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import {
  TemplateForm,
  emptyTemplateForm,
  templateFormToBody,
  type TemplateFormValue,
} from "./TemplateForm";
import type { ShiftTemplate } from "@/lib/types";

export function TemplateCreatePage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState<TemplateFormValue>(emptyTemplateForm);

  const createMut = useMutation({
    mutationFn: async (f: TemplateFormValue) =>
      (await api.post<ShiftTemplate>("/shifts/templates", templateFormToBody(f))).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shifts", "templates"] });
      nav("/app/shifts?tab=templates");
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("shifts_page.template_create_title")}
        breadcrumbs={[
          { label: t("shifts_page.title"), to: "/app/shifts?tab=templates" },
          { label: t("shifts_page.template_create_title") },
        ]}
        icon={<Calendar className="size-5" />}
        description={t("shifts_page.template_create_subtitle")}
      />

      <TemplateForm
        value={form}
        onChange={setForm}
        onSubmit={() => createMut.mutate(form)}
        onCancel={() => nav("/app/shifts?tab=templates")}
        submitting={createMut.isPending}
        submitLabel={t("shifts_page.template_create_submit")}
        errorMessage={createMut.isError ? apiErrorMessage(createMut.error) : null}
      />
    </div>
  );
}
