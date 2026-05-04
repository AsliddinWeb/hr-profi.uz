import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Copy,
  Pencil,
  Plus,
  Power,
  Trash2,
} from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useEnumLabel } from "@/lib/enum";
import { cn } from "@/lib/cn";
import {
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from "@/components/ui/Table";
import type { KPITemplate } from "@/lib/types";

import { TemplateFormDialog } from "./TemplateFormDialog";
import { CATEGORY_COLOR, fmtMoney } from "./utils";

export function TemplatesTab() {
  const { t } = useTranslation();
  const label = useEnumLabel();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<KPITemplate | null>(null);
  const [creating, setCreating] = useState(false);

  const tplQ = useQuery({
    queryKey: ["kpi", "templates"],
    queryFn: async () =>
      (await api.get<KPITemplate[]>("/kpi/templates")).data,
  });

  const dupMut = useMutation({
    mutationFn: async (id: string) =>
      (await api.post<KPITemplate>(`/kpi/templates/${id}/duplicate`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kpi", "templates"] });
      toast.success(t("kpi_page.duplicate"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const toggleMut = useMutation({
    mutationFn: async (tpl: KPITemplate) => {
      if (tpl.is_active) {
        await api.delete(`/kpi/templates/${tpl.id}`);
      } else {
        await api.patch(`/kpi/templates/${tpl.id}`, { is_active: true });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kpi", "templates"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const items = tplQ.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{t("kpi_page.templates")}</p>
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4" />
          {t("kpi_page.create_template")}
        </Button>
      </div>

      <Table className="min-w-[1000px]">
        <THead>
          <TR>
            <TH className="w-1" />
            <TH>{t("kpi_page.template_name")}</TH>
            <TH>{t("kpi_page.category")}</TH>
            <TH>{t("kpi_page.metric_source")}</TH>
            <TH>{t("kpi_page.period_kind")}</TH>
            <TH className="text-right">{t("kpi_page.target")}</TH>
            <TH>{t("kpi_page.reward_type")}</TH>
            <TH className="text-right">{t("kpi_page.reward_amount")}</TH>
            <TH className="text-right">{t("kpi_page.weight")}</TH>
            <TH>{t("kpi_page.is_active")}</TH>
            <TH className="w-[120px] text-right">·</TH>
          </TR>
        </THead>
        <TBody>
          {tplQ.isLoading ? (
            <TR>
              <TD colSpan={11} className="text-center text-sm text-slate-500">
                …
              </TD>
            </TR>
          ) : items.length === 0 ? (
            <TR>
              <TD colSpan={11} className="text-center text-sm text-slate-500">
                {t("kpi_page.no_templates")}
              </TD>
            </TR>
          ) : (
            items.map((tpl) => (
              <TR key={tpl.id} className={cn(!tpl.is_active && "opacity-60")}>
                <TD className="!w-1 !p-0">
                  <div
                    className={cn(
                      "h-full w-1",
                      tpl.is_active ? "bg-emerald-500" : "bg-slate-300"
                    )}
                  />
                </TD>
                <TD>
                  <div className="font-semibold text-slate-800">{tpl.name}</div>
                  {tpl.description && (
                    <div className="mt-0.5 line-clamp-1 text-[11px] text-slate-500">
                      {tpl.description}
                    </div>
                  )}
                  <div className="mt-1 line-clamp-1 font-mono text-[10px] text-slate-400">
                    ƒ {tpl.formula}
                  </div>
                </TD>
                <TD>
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1",
                      CATEGORY_COLOR[tpl.category]
                    )}
                  >
                    {label("kpi_category", tpl.category)}
                  </span>
                </TD>
                <TD className="text-xs text-slate-600">
                  {label("metric_source", tpl.metric_source)}
                </TD>
                <TD className="text-xs text-slate-600">
                  {label("kpi_period_kind", tpl.period_kind)}
                </TD>
                <TD className="text-right tabular-nums text-xs text-slate-700">
                  {tpl.target_value}
                  {tpl.unit ? ` ${tpl.unit}` : ""}
                </TD>
                <TD className="text-xs text-slate-600">
                  {label("reward_type", tpl.reward_type)}
                </TD>
                <TD className="text-right tabular-nums text-sm font-semibold text-emerald-700">
                  {fmtMoney(tpl.reward_amount)}
                </TD>
                <TD className="text-right tabular-nums text-xs text-slate-600">
                  {tpl.weight}×
                </TD>
                <TD>
                  {tpl.is_active ? (
                    <Badge tone="success">●</Badge>
                  ) : (
                    <Badge tone="default">○</Badge>
                  )}
                </TD>
                <TD className="text-right">
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => setEditing(tpl)}
                      className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                      title={t("kpi_page.edit_template") ?? undefined}
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => dupMut.mutate(tpl.id)}
                      className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                      title={t("kpi_page.duplicate") ?? undefined}
                    >
                      <Copy className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleMut.mutate(tpl)}
                      className={cn(
                        "rounded-md p-1.5 hover:bg-slate-100",
                        tpl.is_active
                          ? "text-rose-500 hover:text-rose-700"
                          : "text-emerald-500 hover:text-emerald-700"
                      )}
                      title={
                        tpl.is_active
                          ? t("kpi_page.deactivate") ?? undefined
                          : t("kpi_page.activate") ?? undefined
                      }
                    >
                      {tpl.is_active ? (
                        <Trash2 className="size-3.5" />
                      ) : (
                        <Power className="size-3.5" />
                      )}
                    </button>
                  </div>
                </TD>
              </TR>
            ))
          )}
        </TBody>
      </Table>

      {(creating || editing) && (
        <TemplateFormDialog
          template={editing}
          open
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}
