import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { useEnumLabel } from "@/lib/enum";
import type {
  KPICategory,
  KPIPeriodKind,
  KPITemplate,
  KPITierBracket,
  KPIVariable,
  MetricSource,
  RewardType,
} from "@/lib/types";

const CATEGORY_OPTS: KPICategory[] = [
  "ATTENDANCE",
  "SALES",
  "TASKS",
  "QUALITY",
  "MANAGER_REVIEW",
  "GOAL",
  "CUSTOM",
];
const SOURCE_OPTS: MetricSource[] = ["AUTO", "MANUAL", "HYBRID"];
const PERIOD_OPTS: KPIPeriodKind[] = ["MONTHLY", "QUARTERLY", "WEEKLY"];
const REWARD_OPTS: RewardType[] = [
  "FIXED",
  "PERCENT_OF_SALARY",
  "PER_UNIT",
  "TIERED",
  "PENALTY_PERCENT",
];

interface FormState {
  name: string;
  description: string;
  category: KPICategory;
  metric_source: MetricSource;
  formula: string;
  target_value: string;
  unit: string;
  weight: string;
  period_kind: KPIPeriodKind;
  min_threshold_pct: string;
  max_score_cap_pct: string;
  reward_type: RewardType;
  reward_amount: string;
  tiers: KPITierBracket[];
  requires_manager_review: boolean;
  is_active: boolean;
}

const empty: FormState = {
  name: "",
  description: "",
  category: "ATTENDANCE",
  metric_source: "AUTO",
  formula: "(present_days / max(work_days, 1)) * 100",
  target_value: "100",
  unit: "%",
  weight: "1",
  period_kind: "MONTHLY",
  min_threshold_pct: "0",
  max_score_cap_pct: "",
  reward_type: "FIXED",
  reward_amount: "0",
  tiers: [],
  requires_manager_review: false,
  is_active: true,
};

export function TemplateFormDialog({
  template,
  open,
  onClose,
}: {
  template?: KPITemplate | null;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const label = useEnumLabel();
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(empty);
  const isEdit = !!template;

  useEffect(() => {
    if (template) {
      setForm({
        name: template.name,
        description: template.description ?? "",
        category: template.category,
        metric_source: template.metric_source,
        formula: template.formula,
        target_value: template.target_value,
        unit: template.unit ?? "",
        weight: template.weight,
        period_kind: template.period_kind,
        min_threshold_pct: template.min_threshold_pct,
        max_score_cap_pct: template.max_score_cap_pct ?? "",
        reward_type: template.reward_type,
        reward_amount: template.reward_amount,
        tiers: template.tiers ?? [],
        requires_manager_review: template.requires_manager_review,
        is_active: template.is_active,
      });
    } else {
      setForm(empty);
    }
  }, [template]);

  const varsQ = useQuery({
    queryKey: ["kpi", "variables"],
    queryFn: async () =>
      (await api.get<KPIVariable[]>("/kpi/variables")).data,
    staleTime: 60_000,
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        name: form.name,
        description: form.description || null,
        category: form.category,
        metric_source: form.metric_source,
        formula: form.formula,
        target_value: form.target_value || "0",
        unit: form.unit || null,
        weight: form.weight || "1",
        period_kind: form.period_kind,
        min_threshold_pct: form.min_threshold_pct || "0",
        max_score_cap_pct:
          form.max_score_cap_pct === "" ? null : form.max_score_cap_pct,
        reward_type: form.reward_type,
        reward_amount: form.reward_amount || "0",
        tiers: form.reward_type === "TIERED" ? form.tiers : null,
        requires_manager_review: form.requires_manager_review,
      };
      if (isEdit) {
        payload.is_active = form.is_active;
        return (
          await api.patch<KPITemplate>(
            `/kpi/templates/${template!.id}`,
            payload
          )
        ).data;
      }
      return (await api.post<KPITemplate>("/kpi/templates", payload)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kpi", "templates"] });
      toast.success(t("kpi_page.save_changes"));
      onClose();
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const groupedVars = useMemo(() => {
    const out: Record<string, KPIVariable[]> = {};
    for (const v of varsQ.data ?? []) {
      (out[v.source] ??= []).push(v);
    }
    return out;
  }, [varsQ.data]);

  const addTier = () =>
    setForm((f) => ({
      ...f,
      tiers: [
        ...f.tiers,
        { from_pct: "0", to_pct: "100", multiplier: "1" },
      ],
    }));
  const updateTier = (i: number, patch: Partial<KPITierBracket>) =>
    setForm((f) => ({
      ...f,
      tiers: f.tiers.map((t, j) => (i === j ? { ...t, ...patch } : t)),
    }));
  const removeTier = (i: number) =>
    setForm((f) => ({ ...f, tiers: f.tiers.filter((_, j) => j !== i) }));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={
        isEdit ? t("kpi_page.edit_template") : t("kpi_page.create_template")
      }
      className="max-w-3xl"
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          saveMut.mutate();
        }}
      >
        {/* Basics */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            label={t("kpi_page.template_name")}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
          <div>
            <label className="label">{t("kpi_page.category")}</label>
            <select
              className="input"
              value={form.category}
              onChange={(e) =>
                setForm({ ...form, category: e.target.value as KPICategory })
              }
            >
              {CATEGORY_OPTS.map((c) => (
                <option key={c} value={c}>
                  {label("kpi_category", c)}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label">{t("kpi_page.description")}</label>
            <textarea
              className="input"
              rows={2}
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
            />
          </div>
        </div>

        {/* Source + period + thresholds */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className="label">{t("kpi_page.metric_source")}</label>
            <select
              className="input"
              value={form.metric_source}
              onChange={(e) =>
                setForm({
                  ...form,
                  metric_source: e.target.value as MetricSource,
                })
              }
            >
              {SOURCE_OPTS.map((s) => (
                <option key={s} value={s}>
                  {label("metric_source", s)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">{t("kpi_page.period_kind")}</label>
            <select
              className="input"
              value={form.period_kind}
              onChange={(e) =>
                setForm({
                  ...form,
                  period_kind: e.target.value as KPIPeriodKind,
                })
              }
            >
              {PERIOD_OPTS.map((p) => (
                <option key={p} value={p}>
                  {label("kpi_period_kind", p)}
                </option>
              ))}
            </select>
          </div>
          <Input
            label={t("kpi_page.weight")}
            type="number"
            step="0.1"
            min={0}
            max={100}
            value={form.weight}
            onChange={(e) => setForm({ ...form, weight: e.target.value })}
          />
        </div>

        {/* Target + unit */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Input
            label={t("kpi_page.target")}
            type="number"
            step="0.01"
            min={0}
            value={form.target_value}
            onChange={(e) =>
              setForm({ ...form, target_value: e.target.value })
            }
          />
          <Input
            label={t("kpi_page.unit")}
            value={form.unit}
            onChange={(e) => setForm({ ...form, unit: e.target.value })}
            placeholder="%"
          />
          <Input
            label={t("kpi_page.min_threshold_pct")}
            hint={t("kpi_page.min_threshold_help")}
            type="number"
            step="1"
            min={0}
            max={200}
            value={form.min_threshold_pct}
            onChange={(e) =>
              setForm({ ...form, min_threshold_pct: e.target.value })
            }
          />
          <Input
            label={t("kpi_page.max_score_cap_pct")}
            hint={t("kpi_page.max_score_cap_help")}
            type="number"
            step="1"
            min={0}
            value={form.max_score_cap_pct}
            onChange={(e) =>
              setForm({ ...form, max_score_cap_pct: e.target.value })
            }
            placeholder="—"
          />
        </div>

        {/* Formula */}
        <div>
          <label className="label">{t("kpi_page.formula")}</label>
          <textarea
            className="input font-mono"
            rows={3}
            value={form.formula}
            onChange={(e) => setForm({ ...form, formula: e.target.value })}
            required
          />
          <p className="mt-1 text-[11px] text-slate-500">
            {t("kpi_page.formula_help")}
          </p>
          {/* Variable cheatsheet — shows all available vars grouped by source */}
          {Object.keys(groupedVars).length > 0 && (
            <details className="mt-2 rounded-md border border-slate-200 bg-slate-50/60 p-2">
              <summary className="cursor-pointer text-[11px] font-medium text-slate-600">
                {t("kpi_page.variables_help")}
              </summary>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {Object.entries(groupedVars).map(([src, vars]) => (
                  <div key={src} className="rounded-md bg-white p-2 ring-1 ring-slate-200">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      {t(`kpi_page.var_source_${src}` as never, { defaultValue: src })}
                    </div>
                    <ul className="mt-1 space-y-0.5">
                      {vars.map((v) => (
                        <li key={v.name} className="font-mono text-[10px] text-slate-700">
                          <button
                            type="button"
                            onClick={() =>
                              setForm((f) => ({
                                ...f,
                                formula: f.formula + " " + v.name,
                              }))
                            }
                            className="rounded bg-slate-100 px-1 hover:bg-brand-50 hover:text-brand-700"
                          >
                            {v.name}
                          </button>
                          {v.unit && (
                            <span className="ml-1 text-slate-400">
                              [{v.unit}]
                            </span>
                          )}
                          <div className="text-[9px] text-slate-500">
                            {v.description}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>

        {/* Reward */}
        <div className="rounded-lg border border-slate-200 bg-slate-50/30 p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label">{t("kpi_page.reward_type")}</label>
              <select
                className="input"
                value={form.reward_type}
                onChange={(e) =>
                  setForm({
                    ...form,
                    reward_type: e.target.value as RewardType,
                  })
                }
              >
                {REWARD_OPTS.map((r) => (
                  <option key={r} value={r}>
                    {label("reward_type", r)}
                  </option>
                ))}
              </select>
            </div>
            <Input
              label={t("kpi_page.reward_amount")}
              type="number"
              step="0.01"
              min={0}
              value={form.reward_amount}
              onChange={(e) =>
                setForm({ ...form, reward_amount: e.target.value })
              }
            />
          </div>

          {form.reward_type === "TIERED" && (
            <div className="mt-3">
              <div className="mb-1.5 flex items-center justify-between">
                <label className="label !mb-0">{t("kpi_page.tiers")}</label>
                <button
                  type="button"
                  onClick={addTier}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Plus className="size-3" />
                  {t("kpi_page.tier_add")}
                </button>
              </div>
              <p className="mb-2 text-[11px] text-slate-500">
                {t("kpi_page.tiers_help")}
              </p>
              {form.tiers.length === 0 ? (
                <div className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-center text-[11px] text-slate-400">
                  —
                </div>
              ) : (
                <div className="space-y-1.5">
                  {form.tiers.map((tier, i) => (
                    <div
                      key={i}
                      className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1.5"
                    >
                      <input
                        className="input !py-1 text-xs"
                        type="number"
                        step="1"
                        placeholder={t("kpi_page.tier_from") ?? ""}
                        value={tier.from_pct}
                        onChange={(e) =>
                          updateTier(i, { from_pct: e.target.value })
                        }
                      />
                      <input
                        className="input !py-1 text-xs"
                        type="number"
                        step="1"
                        placeholder={t("kpi_page.tier_to") ?? ""}
                        value={tier.to_pct}
                        onChange={(e) =>
                          updateTier(i, { to_pct: e.target.value })
                        }
                      />
                      <input
                        className="input !py-1 text-xs"
                        type="number"
                        step="0.01"
                        placeholder={t("kpi_page.tier_multiplier") ?? ""}
                        value={tier.multiplier}
                        onChange={(e) =>
                          updateTier(i, { multiplier: e.target.value })
                        }
                      />
                      <button
                        type="button"
                        onClick={() => removeTier(i)}
                        className="rounded-md p-1.5 text-rose-500 hover:bg-rose-50"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={form.requires_manager_review}
            onChange={(e) =>
              setForm({ ...form, requires_manager_review: e.target.checked })
            }
          />
          {t("kpi_page.requires_manager_review")}
        </label>

        {isEdit && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) =>
                setForm({ ...form, is_active: e.target.checked })
              }
            />
            {t("kpi_page.is_active")}
          </label>
        )}

        <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
          >
            {t("common.cancel")}
          </Button>
          <Button type="submit" loading={saveMut.isPending}>
            {isEdit ? t("kpi_page.save_changes") : t("kpi_page.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
