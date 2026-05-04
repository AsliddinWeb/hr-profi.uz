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
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Coins,
  Download,
  FileSpreadsheet,
  HandCoins,
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

interface ReportSpec {
  type: ReportType;
  icon: React.ComponentType<{ className?: string }>;
  tone: "brand" | "emerald" | "indigo" | "amber" | "rose" | "sky";
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

      {/* Report cards */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        {SPECS.map((spec) => (
          <ReportCard
            key={spec.type}
            spec={spec}
            onClick={() => setActiveSpec(spec)}
            label={t(`reports.types.${spec.type}.title`)}
            hint={t(`reports.types.${spec.type}.hint`)}
          />
        ))}
      </div>

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

      {/* Recent jobs */}
      <Card>
        <CardTitle>{t("reports.recent")}</CardTitle>
        <CardSubtitle>{t("reports.recent_hint")}</CardSubtitle>
        {items.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">{t("reports.empty")}</p>
        ) : (
          <div className="mt-3 divide-y divide-slate-200">
            {items.map((job) => (
              <div
                key={job.id}
                className="flex flex-wrap items-center gap-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-800">
                      {t(`reports.types.${job.type}.title`)}
                    </span>
                    <Badge tone={statusTone(job.status)}>
                      {t(`reports.status.${job.status}`)}
                    </Badge>
                    {job.row_count != null && (
                      <span className="text-[11px] text-slate-500">
                        · {job.row_count} {t("reports.rows")}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    {t("reports.created")}: {fmtDateTime(job.created_at, i18n.language)}
                    {job.finished_at && (
                      <>
                        {" · "}
                        {t("reports.finished")}: {fmtDateTime(job.finished_at, i18n.language)}
                      </>
                    )}
                  </div>
                  {job.last_error && (
                    <p className="mt-1 truncate text-[11px] text-rose-700">
                      {job.last_error}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  {job.status === "READY" && job.file_url && (
                    <a
                      href={`/api/v1/reports/${job.id}/download`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100"
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
                    <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                      <Loader2 className="size-3 animate-spin" />
                      {t("reports.processing")}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function ReportCard({
  spec,
  onClick,
  label,
  hint,
}: {
  spec: ReportSpec;
  onClick: () => void;
  label: string;
  hint: string;
}) {
  const Icon = spec.icon;
  const cls = {
    brand: "border-brand-200 bg-brand-50 hover:bg-brand-100 text-brand-900",
    emerald:
      "border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-900",
    indigo:
      "border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-900",
    amber: "border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-900",
    rose: "border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-900",
    sky: "border-sky-200 bg-sky-50 hover:bg-sky-100 text-sky-900",
  }[spec.tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition active:scale-[0.99]",
        cls
      )}
    >
      <Icon className="size-5" />
      <div className="font-semibold">{label}</div>
      <div className="text-[11px] opacity-80">{hint}</div>
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
  const [format, setFormat] = useState<"CSV" | "PDF" | "XLSX">("CSV");

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
      <CardTitle>{t(`reports.types.${spec.type}.title`)}</CardTitle>
      <CardSubtitle>{t(`reports.types.${spec.type}.hint`)}</CardSubtitle>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                    {m}
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
          <label className="flex items-center gap-2 pt-7 text-sm text-slate-700 sm:col-span-2">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
            />
            {t("reports.field_include_inactive")}
          </label>
        )}
        <div className="sm:col-span-2">
          <label className="label">{t("reports.field_format")}</label>
          <div className="flex gap-2">
            {(["CSV", "PDF", "XLSX"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFormat(f)}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-xs font-bold transition",
                  format === f
                    ? "border-brand-600 bg-brand-600 text-white shadow-sm"
                    : "border-slate-200 bg-white text-slate-700 hover:border-brand-300"
                )}
              >
                {f}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            {t("reports.field_format_hint")}
          </p>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          <XCircle className="size-4" />
          {t("common.cancel")}
        </Button>
        <Button
          type="button"
          onClick={submit}
          loading={submitting}
        >
          <CheckCircle2 className="size-4" />
          {t("reports.submit")}
        </Button>
      </div>
    </Card>
  );
}
