import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Building2 } from "lucide-react";

import { api } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import type { Company } from "@/lib/types";

import { CompanyForm } from "./CompanyForm";
import { emptyCompanyForm, type CompanyFormState } from "./utils";

export function CompanyCreatePage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();

  const createMut = useMutation({
    mutationFn: async (f: CompanyFormState) => {
      const body: Record<string, unknown> = {
        name: f.name,
        slug: f.slug,
        plan: f.plan,
        country: f.country,
        timezone: f.timezone,
        currency: f.currency,
        language_default: f.language_default,
        admin_username: f.admin_username,
        admin_password: f.admin_password,
      };
      if (f.subscription_until) body.subscription_until = f.subscription_until;
      if (f.admin_email) body.admin_email = f.admin_email;
      if (f.admin_full_name) body.admin_full_name = f.admin_full_name;
      return (await api.post<Company>("/owner/companies", body)).data;
    },
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ["owner", "companies"] });
      qc.invalidateQueries({ queryKey: ["owner", "stats"] });
      toast.success(t("owner_companies.created_done"));
      // Send the owner straight to the new company's edit page so they can
      // set the logo URL etc.
      nav(`/owner/companies/${c.id}/edit`);
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("owner_companies.create_title")}
        breadcrumbs={[
          { label: t("owner.companies_title"), to: "/owner/companies" },
          { label: t("owner_companies.create_title") },
        ]}
        icon={<Building2 className="size-5" />}
        description={t("owner_companies.create_subtitle")}
      />

      <CompanyForm
        mode="create"
        initial={emptyCompanyForm}
        saving={createMut.isPending}
        error={createMut.error}
        onSubmit={async (f) => {
          await createMut.mutateAsync(f);
        }}
        onCancel={() => nav("/owner/companies")}
      />
    </div>
  );
}
