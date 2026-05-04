import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  CalendarClock,
  Clock,
  Coffee,
  Layers,
  Pencil,
  Plus,
  Search,
  Sunrise,
  Sunset,
  Timer,
  Trash2,
  Zap,
} from "lucide-react";

import { api } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { useEnumLabel } from "@/lib/enum";
import { cn } from "@/lib/cn";
import type { Page, ShiftTemplate, ShiftType } from "@/lib/types";

type TypeFilter = "all" | ShiftType;

export function TemplatesPanel() {
  const { t } = useTranslation();
  const label = useEnumLabel();
  const nav = useNavigate();
  const qc = useQueryClient();

  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  const templatesQ = useQuery({
    queryKey: ["shifts", "templates"],
    queryFn: async () =>
      (await api.get<Page<ShiftTemplate>>("/shifts/templates")).data,
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => api.delete(`/shifts/templates/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shifts", "templates"] }),
  });

  const items = templatesQ.data?.items ?? [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((tp) => {
      if (typeFilter !== "all" && tp.type !== typeFilter) return false;
      if (q && !tp.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, query, typeFilter]);

  const stats = useMemo(() => {
    const active = items.filter((tp) => tp.is_active);
    return {
      total: items.length,
      active: active.length,
      withOvertime: active.filter((tp) => tp.allow_overtime).length,
    };
  }, [items]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid grid-cols-3 gap-3 flex-1 min-w-[260px] sm:flex sm:gap-3">
          <StatPill
            icon={<Layers className="size-4" />}
            label={t("shifts_page.stat_total_templates")}
            value={stats.total}
          />
          <StatPill
            icon={<CalendarClock className="size-4 text-emerald-600" />}
            label={t("shifts_page.stat_active_templates")}
            value={stats.active}
          />
          <StatPill
            icon={<Zap className="size-4 text-amber-500" />}
            label={t("shifts_page.stat_overtime_enabled")}
            value={stats.withOvertime}
          />
        </div>
        <Button onClick={() => nav("/app/shifts/templates/new")}>
          <Plus className="size-4" />
          {t("shifts_page.add_template")}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[260px] flex-1">
          <Input
            label={t("shifts_page.search_label")}
            placeholder={t("shifts_page.search_placeholder") ?? ""}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            prefix={<Search className="size-4" />}
          />
        </div>
        <div>
          <label className="label">{t("shifts_page.type")}</label>
          <select
            className="input min-w-[180px]"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
          >
            <option value="all">{t("branches.status_all")}</option>
            <option value="FIXED">{label("shift_type", "FIXED")}</option>
            <option value="FLEXIBLE">{label("shift_type", "FLEXIBLE")}</option>
            <option value="SPLIT">{label("shift_type", "SPLIT")}</option>
          </select>
        </div>
      </div>

      {templatesQ.isLoading ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          {t("common.loading")}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white px-6 py-12">
          <div className="mx-auto flex max-w-sm flex-col items-center gap-2 text-center">
            <CalendarClock className="size-8 text-slate-300" />
            <p className="text-sm font-medium text-slate-700">
              {items.length === 0
                ? t("shifts_page.templates_empty_title")
                : t("shifts_page.templates_no_match")}
            </p>
            <p className="text-xs text-slate-500">
              {items.length === 0
                ? t("shifts_page.templates_empty_hint")
                : t("shifts_page.templates_no_match_hint")}
            </p>
            {items.length === 0 && (
              <Button
                type="button"
                onClick={() => nav("/app/shifts/templates/new")}
                className="mt-2"
              >
                <Plus className="size-4" />
                {t("shifts_page.add_template")}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((tp) => (
            <TemplateCard
              key={tp.id}
              template={tp}
              onEdit={() => nav(`/app/shifts/templates/${tp.id}/edit`)}
              onDelete={() => {
                if (window.confirm(t("shifts_page.delete_confirm", { name: tp.name }) || "Delete?")) {
                  deleteMut.mutate(tp.id);
                }
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TemplateCard({
  template,
  onEdit,
  onDelete,
}: {
  template: ShiftTemplate;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const label = useEnumLabel();
  const start = template.start_time?.slice(0, 5);
  const end = template.end_time?.slice(0, 5);
  const overnight = !!start && !!end && start >= end;

  return (
    <div
      className={cn(
        "group relative flex flex-col rounded-lg border border-slate-200 bg-white p-4 transition hover:shadow-md",
        !template.is_active && "opacity-60"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-slate-800">
              {template.name}
            </h3>
            {!template.is_active && (
              <Badge tone="danger">{t("common.inactive")}</Badge>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge
              tone={
                template.type === "FIXED"
                  ? "info"
                  : template.type === "FLEXIBLE"
                  ? "default"
                  : "warning"
              }
            >
              {label("shift_type", template.type)}
            </Badge>
            {template.allow_overtime && (
              <Badge tone="success">
                <Zap className="mr-0.5 inline size-3" />
                {t("shifts_page.overtime_short")}
              </Badge>
            )}
            {overnight && <Badge tone="warning">{t("shifts_page.overnight_badge")}</Badge>}
          </div>
        </div>
        <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
          <button
            type="button"
            onClick={onEdit}
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-brand-600"
            aria-label={t("common.edit")}
            title={t("common.edit") ?? undefined}
          >
            <Pencil className="size-4" />
          </button>
          {template.is_active && (
            <button
              type="button"
              onClick={onDelete}
              className="rounded-md p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
              aria-label={t("common.delete")}
              title={t("common.delete") ?? undefined}
            >
              <Trash2 className="size-4" />
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          icon={<Sunrise className="size-3.5" />}
          label={t("shifts_page.start")}
          value={start ?? "—"}
        />
        <Stat
          icon={<Sunset className="size-3.5" />}
          label={t("shifts_page.end")}
          value={end ?? "—"}
        />
        <Stat
          icon={<Coffee className="size-3.5" />}
          label={t("shifts_page.break")}
          value={`${template.break_minutes} ${t("shifts_page.minutes_short")}`}
        />
        <Stat
          icon={<Timer className="size-3.5" />}
          label={t("shifts_page.expected_hours_short")}
          value={template.expected_hours ? `${template.expected_hours} h` : "—"}
          primary
        />
      </div>

      <button
        type="button"
        onClick={onEdit}
        className="absolute inset-0 rounded-lg"
        aria-label={t("common.edit") ?? undefined}
      />
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  primary,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  primary?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-md bg-slate-50 px-2.5 py-1.5",
        primary && "bg-brand-50 ring-1 ring-brand-200"
      )}
    >
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-500">
        {icon}
        {label}
      </div>
      <div
        className={cn(
          "mt-0.5 text-sm font-semibold tabular-nums text-slate-800",
          primary && "text-brand-700"
        )}
      >
        {value}
      </div>
    </div>
  );
}

function StatPill({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="flex min-w-[140px] items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div>
        <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
        <div className="mt-0.5 text-xl font-semibold text-slate-800">{value}</div>
      </div>
      <span className="flex size-8 items-center justify-center rounded-md bg-slate-100">
        {icon}
      </span>
    </div>
  );
}

// also needs Clock — kept for parity
void Clock;
