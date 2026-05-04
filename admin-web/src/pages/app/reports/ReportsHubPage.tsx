import { useMemo, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  AlertTriangle,
  Calendar,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Coins,
  Download,
  FileSpreadsheet,
  HandCoins,
  Hourglass,
  Loader2,
  RefreshCw,
  Trophy,
  Umbrella,
  Users,
  XCircle,
} from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardSubtitle, CardTitle } from "@/components/ui/Card";
import { PageHeader } from "@/components/PageHeader";
import { useAuthStore } from "@/stores/auth";
import { cn } from "@/lib/cn";
import type {
  Page as PaginatedPage,
  ReportJob,
  ReportType,
} from "@/lib/types";

type Tone = "brand" | "emerald" | "indigo" | "amber" | "rose" | "sky";

interface ReportSpec {
  type: ReportType;
  icon: React.ComponentType<{ className?: string }>;
  tone: Tone;
  /** Which params the form should ask for. */
  fields: (
    | "date_range"
    | "year_month"
    | "year_only"
    | "branch"
    | "include_inactive"
  )[];
}

const SPECS: ReportSpec[] = [
  {
    type: "ATTENDANCE_DAILY",
    icon: ClipboardCheck,
    tone: "brand",
    fields: ["date_range", "branch"],
  },
  {
    type: "ATTENDANCE_MONTHLY",
    icon: CalendarDays,
    tone: "indigo",
    fields: ["year_month", "branch"],
  },
  {
    type: "SALARY_REGISTER",
    icon: Coins,
    tone: "emerald",
    fields: ["year_month", "branch"],
  },
  {
    type: "EMPLOYEE_ROSTER",
    icon: Users,
    tone: "amber",
    fields: ["branch", "include_inactive"],
  },
  {
    type: "KPI_SUMMARY",
    icon: Trophy,
    tone: "indigo",
    fields: ["year_month", "branch"],
  },
  {
    type: "LEAVE_BALANCE",
    icon: Umbrella,
    tone: "sky",
    fields: ["year_only", "branch"],
  },
  {
    type: "BONUS_DEDUCTION_REGISTER",
    icon: HandCoins,
    tone: "emerald",
    fields: ["date_range", "branch"],
  },
  {
    type: "LATE_ABSENCE_TREND",
    icon: AlertTriangle,
    tone: "rose",
    fields: ["date_range", "branch"],
  },
];

// Tailwind class buckets per accent tone — kept side-by-side so adding a
// new tone is one diff instead of three.
const TONE_CARD: Record<Tone, string> = {
  brand: "ring-brand-200 hover:ring-brand-300 hover:shadow-brand-200/40",
  emerald: "ring-emerald-200 hover:ring-emerald-300 hover:shadow-emerald-200/40",
  indigo: "ring-indigo-200 hover:ring-indigo-300 hover:shadow-indigo-200/40",
  amber: "ring-amber-200 hover:ring-amber-300 hover:shadow-amber-200/40",
  rose: "ring-rose-200 hover:ring-rose-300 hover:shadow-rose-200/40",
  sky: "ring-sky-200 hover:ring-sky-300 hover:shadow-sky-200/40",
};
const TONE_ICON_BG: Record<Tone, string> = {
  brand: "bg-brand-100 text-brand-700",
  emerald: "bg-emerald-100 text-emerald-700",
  indigo: "bg-indigo-100 text-indigo-700",
  amber: "bg-amber-100 text-amber-700",
  rose: "bg-rose-100 text-rose-700",
  sky: "bg-sky-100 text-sky-700",
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmtDateTime(iso: string | null, locale: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(locale, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusTone(s: ReportJob["status"]): Parameters<typeof Badge>[0]["tone"] {
  switch (s) {
    case "READY":
      return "success";
    case "FAILED":
      return "danger";
    case "RUNNING":
      return "info";
    case "PENDING":
    default:
      return "default";
  }
}

function statusIcon(s: ReportJob["status"]) {
  switch (s) {
    case "READY":
      return <CheckCircle2 className="size-3.5 text-emerald-600" />;
    case "FAILED":
      return <XCircle className="size-3.5 text-rose-600" />;
    case "RUNNING":
      return <Loader2 className="size-3.5 animate-spin text-brand-600" />;
    case "PENDING":
    default:
      return <Hourglass className="size-3.5 text-slate-500" />;
  }
}

export function ReportsHubPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const role = useAuthStore((s) => s.user?.role);
  const isBM = role === "BRANCH_MANAGER";

  const [activeSpec, setActiveSpec] = useState<ReportSpec | null>(null);

  const jobsQ = useQuery({
    queryKey: ["reports", "jobs"],
    queryFn: async () =>
      (await api.get<PaginatedPage<ReportJob>>("/reports", { params: { size: 50 } })).data,
    refetchInterval: 5_000,
  });

  const createMut = useMutation({
    mutationFn: async (body: {
      type: ReportType;
      format: "CSV" | "PDF" | "XLSX";
      params: Record<string, unknown>;
    }) => (await api.post<ReportJob>("/reports", body)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reports"] });
      toast.success(t("reports.queued"));
      setActiveSpec(null);
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const retryMut = useMutation({
    mutationFn: async (id: string) =>
      (await api.post<ReportJob>(`/reports/${id}/retry`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reports"] });
      toast.success(t("reports.queued"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const items = jobsQ.data?.items ?? [];
  const inFlight = items.filter(
    (i) => i.status === "PENDING" || i.status === "RUNNING"
  ).length;
  const ready = items.filter((i) => i.status === "READY").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("reports.title")}
        breadcrumbs={[{ label: t("reports.title") }]}
        icon={<FileSpreadsheet className="size-5" />}
        description={
          isBM ? t("reports.subtitle_bm") : t("reports.subtitle")
        }
      />

      {/* At-a-glance counters above the picker. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Stat
          tone="brand"
          icon={<FileSpreadsheet className="size-4" />}
          label={t("reports.stat_total")}
          value={items.length}
        />
        <Stat
          tone="emerald"
          icon={<CheckCircle2 className="size-4" />}
          label={t("reports.stat_ready")}
          value={ready}
        />
        <Stat
          tone="amber"
          icon={<Hourglass className="size-4" />}
          label={t("reports.stat_in_flight")}
          value={inFlight}
        />
        <Stat
          tone="rose"
          icon={<AlertTriangle className="size-4" />}
          label={t("reports.stat_failed")}
          value={items.filter((i) => i.status === "FAILED").length}
        />
      </div>

      {/* Picker — one card per report type. */}
      <section className="space-y-3">
        <header>
          <h2 className="text-sm font-semibold text-slate-800">
            {t("reports.picker_title")}
          </h2>
          <p className="text-[11px] text-slate-500">
            {t("reports.picker_hint")}
          </p>
        </header>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {SPECS.map((spec) => (
            <ReportCard
              key={spec.type}
              spec={spec}
              active={activeSpec?.type === spec.type}
              onClick={() =>
                setActiveSpec((cur) => (cur?.type === spec.type ? null : spec))
              }
              label={t(`reports.types.${spec.type}.title`)}
              hint={t(`reports.types.${spec.type}.hint`)}
            />
          ))}
        </div>
      </section>

      {/* Inline create form — appears under the picker when a card is open. */}
      {activeSpec && (
        <CreateForm
          spec={activeSpec}
          onCancel={() => setActiveSpec(null)}
          onSubmit={(format, params) =>
            createMut.mutate({ type: activeSpec.type, format, params })
          }
          submitting={createMut.isPending}
        />
      )}

      {/* Recent jobs. */}
      <Card>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle>{t("reports.recent")}</CardTitle>
            <CardSubtitle>{t("reports.recent_hint")}</CardSubtitle>
          </div>
          {jobsQ.isFetching && (
            <Loader2 className="size-4 animate-spin text-slate-400" />
          )}
        </div>

        {items.length === 0 ? (
          <div className="mt-6 flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50/40 py-10 text-center">
            <FileSpreadsheet className="size-7 text-slate-300" />
            <p className="text-sm font-medium text-slate-600">
              {t("reports.empty_title")}
            </p>
            <p className="text-[11px] text-slate-500">{t("reports.empty")}</p>
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-slate-200">
            {items.map((job) => (
              <li
                key={job.id}
                className="flex flex-wrap items-center gap-3 py-3"
              >
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-100">
                  {statusIcon(job.status)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-800">
                      {t(`reports.types.${job.type}.title`)}
                    </span>
                    <Badge tone={statusTone(job.status)}>
                      {t(`reports.status.${job.status}`)}
                    </Badge>
                    {job.format && (
                      <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-slate-600">
                        {job.format}
                      </span>
                    )}
                    {job.row_count != null && (
                      <span className="text-[11px] text-slate-500">
                        · {job.row_count.toLocaleString()} {t("reports.rows")}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[11px] text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="size-3" />
                      {fmtDateTime(job.created_at, i18n.language)}
                    </span>
                    {job.finished_at && (
                      <span className="inline-flex items-center gap-1">
                        <Clock className="size-3" />
                        {fmtDateTime(job.finished_at, i18n.language)}
                      </span>
                    )}
                  </div>
                  {job.last_error && (
                    <p className="mt-1.5 truncate rounded-md bg-rose-50 px-2 py-1 text-[11px] text-rose-700 ring-1 ring-rose-100">
                      {job.last_error}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {job.status === "READY" && job.file_url && (
                    <a
                      href={`/api/v1/reports/${job.id}/download`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm shadow-emerald-600/30 transition hover:bg-emerald-700"
                    >
                      <Download className="size-3.5" />
                      {t("reports.download")}
                    </a>
                  )}
                  {job.status === "FAILED" && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => retryMut.mutate(job.id)}
                      loading={retryMut.isPending}
                    >
                      <RefreshCw className="size-3.5" />
                      {t("reports.retry")}
                    </Button>
                  )}
                  {(job.status === "PENDING" || job.status === "RUNNING") && (
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                      <Loader2 className="size-3 animate-spin" />
                      {t("reports.processing")}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Stat({
  tone,
  icon,
  label,
  value,
}: {
  tone: Tone;
  icon: React.ReactNode;
  label: string;
  value: number | string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-lg",
            TONE_ICON_BG[tone]
          )}
        >
          {icon}
        </span>
        <span className="truncate text-[11px] font-medium uppercase tracking-wide text-slate-500">
          {label}
        </span>
      </div>
      <div className="mt-1.5 text-2xl font-bold tabular-nums text-slate-900">
        {value}
      </div>
    </div>
  );
}

function ReportCard({
  spec,
  active,
  onClick,
  label,
  hint,
}: {
  spec: ReportSpec;
  active: boolean;
  onClick: () => void;
  label: string;
  hint: string;
}) {
  const Icon = spec.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex h-full flex-col items-start gap-3 rounded-xl bg-white p-4 text-left ring-1 transition hover:-translate-y-0.5 hover:shadow-md",
        TONE_CARD[spec.tone],
        active && "ring-2 -translate-y-0.5 shadow-md"
      )}
    >
      <span
        className={cn(
          "flex size-10 items-center justify-center rounded-lg transition",
          TONE_ICON_BG[spec.tone],
          active && "scale-110"
        )}
      >
        <Icon className="size-5" />
      </span>
      <div className="space-y-1">
        <div className="text-sm font-semibold leading-tight text-slate-900">
          {label}
        </div>
        <div className="text-[11px] leading-snug text-slate-500">{hint}</div>
      </div>
    </button>
  );
}

function CreateForm({
  spec,
  onCancel,
  onSubmit,
  submitting,
}: {
  spec: ReportSpec;
  onCancel: () => void;
  onSubmit: (
    format: "CSV" | "PDF" | "XLSX",
    params: Record<string, unknown>
  ) => void;
  submitting: boolean;
}) {
  const { t } = useTranslation();
  const today = useMemo(() => new Date(), []);

  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [format, setFormat] = useState<"CSV" | "PDF" | "XLSX">("XLSX");

  const Icon = spec.icon;

  const submit = () => {
    const params: Record<string, unknown> = {};
    if (spec.fields.includes("date_range")) {
      params.from = from;
      params.to = to;
    }
    if (spec.fields.includes("year_month")) {
      params.year = year;
      params.month = month;
    }
    if (spec.fields.includes("year_only")) {
      params.year = year;
    }
    if (spec.fields.includes("include_inactive")) {
      params.include_inactive = includeInactive;
    }
    onSubmit(format, params);
  };

  return (
    <Card>
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg",
            TONE_ICON_BG[spec.tone]
          )}
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <CardTitle>{t(`reports.types.${spec.type}.title`)}</CardTitle>
          <CardSubtitle>{t(`reports.types.${spec.type}.hint`)}</CardSubtitle>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {spec.fields.includes("date_range") && (
          <>
            <div>
              <label className="label">{t("reports.field_from")}</label>
              <input
                type="date"
                className="input"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="label">{t("reports.field_to")}</label>
              <input
                type="date"
                className="input"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                min={from}
              />
            </div>
          </>
        )}
        {spec.fields.includes("year_month") && (
          <>
            <div>
              <label className="label">{t("reports.field_year")}</label>
              <input
                type="number"
                className="input"
                min={2020}
                max={2100}
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="label">{t("reports.field_month")}</label>
              <select
                className="input"
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>
                    {m.toString().padStart(2, "0")}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
        {spec.fields.includes("year_only") && (
          <div>
            <label className="label">{t("reports.field_year")}</label>
            <input
              type="number"
              className="input"
              min={2020}
              max={2100}
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            />
          </div>
        )}
        {spec.fields.includes("include_inactive") && (
          <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2 text-sm text-slate-700 sm:col-span-2">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
              className="size-4 accent-brand-600"
            />
            {t("reports.field_include_inactive")}
          </label>
        )}
        <div className="sm:col-span-2">
          <label className="label">{t("reports.field_format")}</label>
          <div className="flex flex-wrap gap-2">
            {(["XLSX", "PDF", "CSV"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFormat(f)}
                className={cn(
                  "rounded-lg border px-4 py-2 text-xs font-bold transition",
                  format === f
                    ? "border-brand-600 bg-brand-600 text-white shadow-sm shadow-brand-600/30"
                    : "border-slate-200 bg-white text-slate-700 hover:border-brand-300 hover:bg-brand-50/40"
                )}
              >
                {f}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-slate-500">
            {t("reports.field_format_hint")}
          </p>
        </div>
      </div>

      <div className="mt-5 flex justify-end gap-2 border-t border-slate-200 pt-4">
        <Button type="button" variant="secondary" onClick={onCancel}>
          <XCircle className="size-4" />
          {t("common.cancel")}
        </Button>
        <Button type="button" onClick={submit} loading={submitting}>
          <CheckCircle2 className="size-4" />
          {t("reports.submit")}
        </Button>
      </div>
    </Card>
  );
}
