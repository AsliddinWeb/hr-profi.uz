import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Calendar } from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import {
  TemplateForm,
  emptyTemplateForm,
  templateFormToBody,
  templateToForm,
  type TemplateFormValue,
} from "./TemplateForm";
import type { Page, ShiftTemplate } from "@/lib/types";

export function TemplateEditPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const [form, setForm] = useState<TemplateFormValue>(emptyTemplateForm);

  // The backend doesn't expose GET /shifts/templates/{id}, so we fetch the
  // listing once and pluck out the one we want. Templates are tiny.
  const templatesQ = useQuery({
    queryKey: ["shifts", "templates"],
    queryFn: async () =>
      (await api.get<Page<ShiftTemplate>>("/shifts/templates")).data,
  });

  const template = templatesQ.data?.items.find((t) => t.id === id) ?? null;

  useEffect(() => {
    if (template) setForm(templateToForm(template));
  }, [template]);

  const updateMut = useMutation({
    mutationFn: async (f: TemplateFormValue) =>
      (await api.patch<ShiftTemplate>(`/shifts/templates/${id}`, templateFormToBody(f))).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shifts", "templates"] });
      nav("/app/shifts?tab=templates");
    },
  });

  if (templatesQ.isLoading) {
    return <p className="text-sm text-slate-500">{t("common.loading")}</p>;
  }
  if (!template && !templatesQ.isLoading) {
    return (
      <p className="text-sm text-red-600">
        {t("shifts_page.template_not_found")}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("shifts_page.template_edit_title")}
        breadcrumbs={[
          { label: t("shifts_page.title"), to: "/app/shifts?tab=templates" },
          { label: template?.name ?? t("shifts_page.template_edit_title") },
        ]}
        icon={<Calendar className="size-5" />}
      />

      <TemplateForm
        value={form}
        onChange={setForm}
        onSubmit={() => updateMut.mutate(form)}
        onCancel={() => nav("/app/shifts?tab=templates")}
        submitting={updateMut.isPending}
        submitLabel={t("common.save_changes")}
        errorMessage={updateMut.isError ? apiErrorMessage(updateMut.error) : null}
        isEdit
      />
    </div>
  );
}
