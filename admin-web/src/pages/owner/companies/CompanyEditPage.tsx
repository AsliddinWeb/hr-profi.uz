import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Building2,
  PauseOctagon,
  PlayCircle,
  Trash2,
} from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/PageHeader";
import { useEnumLabel } from "@/lib/enum";
import type { Company } from "@/lib/types";

import { CompanyAdminCard } from "./CompanyAdminCard";
import { CompanyForm } from "./CompanyForm";
import { fromCompany, type CompanyFormState } from "./utils";

export function CompanyEditPage() {
  const { id = "" } = useParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const label = useEnumLabel();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const companyQ = useQuery({
    queryKey: ["owner", "companies", id],
    queryFn: async () =>
      (await api.get<Company>(`/owner/companies/${id}`)).data,
    enabled: !!id,
  });

  const updateMut = useMutation({
    mutationFn: async (f: CompanyFormState) => {
      const body: Record<string, unknown> = {
        name: f.name,
        slug: f.slug,
        country: f.country,
        timezone: f.timezone,
        currency: f.currency,
        language_default: f.language_default,
        plan: f.plan,
      };
      body.logo_url = f.logo_url || null;
      body.subscription_until = f.subscription_until || null;
      return (
        await api.patch<Company>(`/owner/companies/${id}`, body)
      ).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["owner", "companies"] });
      qc.invalidateQueries({ queryKey: ["owner", "stats"] });
      toast.success(t("common.save_changes"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const suspendMut = useMutation({
    mutationFn: async (reason: string) =>
      api.post(`/owner/companies/${id}/suspend`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["owner"] });
      toast.success(t("owner_companies.suspended_done"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const unsuspendMut = useMutation({
    mutationFn: async () => api.post(`/owner/companies/${id}/unsuspend`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["owner"] });
      toast.success(t("owner_companies.unsuspended_done"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const hardDeleteMut = useMutation({
    mutationFn: async () => api.delete(`/owner/companies/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["owner"] });
      toast.success(t("owner_companies.deleted_done"));
      nav("/owner/companies");
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  if (companyQ.isLoading) {
    return <div className="p-6 text-sm text-slate-500">{t("common.loading")}</div>;
  }
  if (!companyQ.data) {
    return (
      <div className="p-6 text-sm text-rose-600">{t("common.not_found")}</div>
    );
  }

  const c = companyQ.data;
  const subActive = c.is_active;

  return (
    <div className="space-y-6">
      <PageHeader
        title={c.name}
        breadcrumbs={[
          { label: t("owner.companies_title"), to: "/owner/companies" },
          { label: c.name },
        ]}
        icon={<Building2 className="size-5" />}
        description={
          <span className="inline-flex items-center gap-2">
            <code className="font-mono text-xs">{c.slug}</code>
            <Badge tone={subActive ? "success" : "danger"}>
              {subActive
                ? t("owner_companies.status_active")
                : t("owner_companies.status_suspended")}
            </Badge>
            <Badge
              tone={
                c.plan === "ENTERPRISE"
                  ? "warning"
                  : c.plan === "PRO"
                    ? "info"
                    : "default"
              }
            >
              {label("company_plan", c.plan)}
            </Badge>
            {c.subscription_until && (
              <span className="text-[11px] text-slate-500">
                {t("owner_companies.subscription_until")}:{" "}
                {new Date(c.subscription_until).toLocaleDateString(
                  i18n.language
                )}
              </span>
            )}
          </span>
        }
        actions={
          <div className="flex gap-2">
            {subActive ? (
              <Button
                type="button"
                variant="secondary"
                onClick={async () => {
                  const reason = window.prompt(
                    t("owner_companies.suspend_reason_prompt") ?? ""
                  );
                  if (!reason) return;
                  setBusy(true);
                  await suspendMut.mutateAsync(reason);
                  setBusy(false);
                }}
                loading={busy || suspendMut.isPending}
              >
                <PauseOctagon className="size-4" />
                {t("owner_companies.suspend")}
              </Button>
            ) : (
              <Button
                type="button"
                variant="success"
                onClick={() => unsuspendMut.mutate()}
                loading={unsuspendMut.isPending}
              >
                <PlayCircle className="size-4" />
                {t("owner_companies.unsuspend")}
              </Button>
            )}
            <Button
              type="button"
              variant="danger"
              onClick={() => {
                if (
                  window.confirm(
                    t("owner_companies.hard_delete_confirm", {
                      name: c.name,
                    }) ?? ""
                  )
                ) {
                  hardDeleteMut.mutate();
                }
              }}
              loading={hardDeleteMut.isPending}
            >
              <Trash2 className="size-4" />
              {t("owner_companies.hard_delete")}
            </Button>
          </div>
        }
      />

      {!subActive && c.suspended_reason && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          <strong>{t("owner_companies.suspended_at")}:</strong>{" "}
          {c.suspended_at
            ? new Date(c.suspended_at).toLocaleString(i18n.language)
            : "—"}
          <br />
          <strong>{t("owner_companies.suspend_reason")}:</strong>{" "}
          {c.suspended_reason}
        </div>
      )}

      <CompanyForm
        mode="edit"
        companyId={c.id}
        initial={fromCompany(c)}
        saving={updateMut.isPending}
        error={updateMut.error}
        onSubmit={async (f) => {
          await updateMut.mutateAsync(f);
        }}
        onCancel={() => nav("/owner/companies")}
      />

      <CompanyAdminCard companyId={c.id} />
    </div>
  );
}
