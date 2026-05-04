import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Camera,
  Clock,
  FileEdit,
  LogIn,
  LogOut,
  MapPin,
  QrCode,
  ScanFace,
  Smartphone,
  TrendingUp,
} from "lucide-react";

import { api } from "@/lib/api";
import { Badge } from "@/components/ui/Badge";
import { Dialog } from "@/components/ui/Dialog";
import { useEnumLabel } from "@/lib/enum";
import { cn } from "@/lib/cn";
import type {
  AttendanceMethod,
  AttendanceRecord,
  DailyOverviewRow,
  Page,
} from "@/lib/types";

import { fmtHM, fmtTime, initialsOf } from "./utils";

const METHOD_ICON: Record<AttendanceMethod, React.ComponentType<{ className?: string }>> = {
  MOBILE_APP: Smartphone,
  FACE_DEVICE: ScanFace,
  QR_CODE: QrCode,
  MANUAL: FileEdit,
};

interface Props {
  open: boolean;
  row: DailyOverviewRow | null;
  /** Date the parent tab is viewing. Defaults to today when omitted. */
  date?: string;
  onClose: () => void;
}

/** Per-employee detail modal launched from a Live tab card. Shows the day's
 * attendance timeline with selfies, GPS, late/OT and method icons — the full
 * "what happened today" view without leaving the Live tab. */
export function LiveCardDetailsDialog({ open, row, date, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const label = useEnumLabel();

  const dayIso = useMemo(() => {
    if (date) return date;
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    // re-key when dialog reopens so day stays correct after midnight
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, open]);
  const isToday = dayIso === new Date().toISOString().slice(0, 10);

  const recordsQ = useQuery({
    queryKey: ["attendance", "records", "live-detail", row?.employee_id, dayIso],
    queryFn: async () =>
      (
        await api.get<Page<AttendanceRecord>>("/attendance/records", {
          params: {
            size: 50,
            employee_id: row!.employee_id,
            from: dayIso,
            to: dayIso,
          },
        })
      ).data,
    enabled: !!row?.employee_id && open,
    refetchInterval: isToday ? 30_000 : false,
    staleTime: 0,
  });

  if (!open || !row) return null;
  // Sort ascending so the timeline reads top-down.
  const records = (recordsQ.data?.items ?? [])
    .slice()
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const checkIns = records.filter((r) => r.check_type === "CHECK_IN").length;
  const checkOuts = records.filter((r) => r.check_type === "CHECK_OUT").length;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("attendance.live_detail_title")}
      className="max-w-3xl"
    >
      <div className="space-y-4">
        {/* Employee header */}
        <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          {row.photo_url ? (
            <img
              src={row.photo_url}
              alt=""
              className="size-12 rounded-full object-cover ring-1 ring-slate-200"
            />
          ) : (
            <span className="flex size-12 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700">
              {initialsOf(row.full_name) || "•"}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-slate-800">{row.full_name}</div>
            <div className="text-xs text-slate-500">
              {row.position || row.employee_code}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">
              {t("attendance.live_status")}
            </div>
            <Badge tone={badgeTone(row.shift_status)}>
              {label("shift_status_label", row.shift_status)}
            </Badge>
          </div>
        </div>

        {/* Day summary */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Tile
            icon={<LogIn className="size-3 text-emerald-600" />}
            label={t("attendance.live_check_in")}
            value={fmtTime(row.first_check_in, i18n.language)}
          />
          <Tile
            icon={<LogOut className="size-3 text-slate-500" />}
            label={t("attendance.live_check_out")}
            value={
              row.is_currently_in
                ? t("attendance.still_in")
                : fmtTime(row.last_check_out, i18n.language)
            }
            highlight={row.is_currently_in}
          />
          <Tile
            icon={<Clock className="size-3 text-brand-600" />}
            label={t("attendance.live_worked")}
            value={fmtHM(row.minutes_worked)}
            highlight={row.is_currently_in}
          />
          <Tile
            icon={<TrendingUp className="size-3 text-emerald-600" />}
            label={t("attendance.live_overtime")}
            value={row.overtime_minutes > 0 ? `+${row.overtime_minutes}m` : "—"}
          />
        </div>

        {/* Late warning */}
        {row.late_minutes > 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <Clock className="mr-1 inline size-3" />
            {t("attendance.live_detail_late_warning", { minutes: row.late_minutes })}
          </div>
        )}

        {/* Records timeline */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {t("attendance.live_detail_timeline")}
            </h3>
            <div className="text-[10px] tabular-nums text-slate-400">
              {checkIns} <LogIn className="mx-0.5 inline size-3" /> · {checkOuts}{" "}
              <LogOut className="mx-0.5 inline size-3" />
            </div>
          </div>

          {recordsQ.isLoading ? (
            <p className="py-4 text-center text-xs text-slate-500">{t("common.loading")}</p>
          ) : records.length === 0 ? (
            <div className="rounded-lg border border-dashed border-rose-200 bg-rose-50/50 px-4 py-6 text-center">
              <p className="text-sm font-medium text-rose-700">
                {t("attendance.live_detail_no_records")}
              </p>
              <p className="mt-0.5 text-xs text-rose-600/80">
                {t("attendance.live_detail_no_records_hint")}
              </p>
            </div>
          ) : (
            <ol className="space-y-2">
              {records.map((r, idx) => (
                <RecordRow
                  key={r.id}
                  record={r}
                  locale={i18n.language}
                  rejected={r.status === "REJECTED"}
                  hasNext={idx < records.length - 1}
                  label={label}
                  t={t}
                />
              ))}
            </ol>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function RecordRow({
  record,
  locale,
  rejected,
  hasNext,
  label,
  t,
}: {
  record: AttendanceRecord;
  locale: string;
  rejected: boolean;
  hasNext: boolean;
  label: ReturnType<typeof useEnumLabel>;
  t: (k: string, opts?: Record<string, unknown>) => string;
}) {
  const Icon = METHOD_ICON[record.method] ?? FileEdit;
  const isIn = record.check_type === "CHECK_IN";
  return (
    <li className="relative">
      {/* Timeline connector */}
      {hasNext && (
        <span className="absolute left-[18px] top-10 h-[calc(100%-12px)] w-px bg-slate-200" />
      )}
      <div
        className={cn(
          "flex gap-3 rounded-lg border p-3",
          rejected
            ? "border-rose-200 bg-rose-50/50 opacity-70"
            : isIn
            ? "border-emerald-200 bg-emerald-50/40"
            : "border-slate-200 bg-white"
        )}
      >
        {/* Type bubble */}
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full ring-2 ring-white",
            isIn ? "bg-emerald-500 text-white" : "bg-slate-500 text-white"
          )}
          title={label("check_type", record.check_type)}
        >
          {isIn ? <LogIn className="size-4" /> : <LogOut className="size-4" />}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-base font-semibold tabular-nums text-slate-800">
              {new Date(record.timestamp).toLocaleTimeString(locale, {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <Badge tone={isIn ? "success" : "info"}>
              {label("check_type", record.check_type)}
            </Badge>
            <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
              <Icon className="size-3" />
              {label("attendance_method", record.method)}
            </span>
            {rejected && <Badge tone="danger">{label("attendance_status", "REJECTED")}</Badge>}
            {record.status === "SUSPICIOUS" && (
              <Badge tone="warning">{label("attendance_status", "SUSPICIOUS")}</Badge>
            )}
          </div>

          {/* Late / OT */}
          <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
            {record.late_minutes > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-700 ring-1 ring-amber-200">
                <Clock className="size-3" />
                +{record.late_minutes}m {t("attendance.live_late")}
              </span>
            )}
            {record.overtime_minutes > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-700 ring-1 ring-emerald-200">
                <TrendingUp className="size-3" />
                +{record.overtime_minutes}m {t("attendance.live_overtime")}
              </span>
            )}
            {record.face_match_score && (
              <span className="inline-flex items-center gap-1 rounded-md bg-slate-50 px-1.5 py-0.5 text-slate-600 ring-1 ring-slate-200">
                <ScanFace className="size-3" />
                {Number(record.face_match_score).toFixed(2)}
              </span>
            )}
          </div>

          {/* GPS link */}
          {record.latitude != null && record.longitude != null && (
            <a
              href={`https://yandex.com/maps/?ll=${record.longitude},${record.latitude}&z=17&pt=${record.longitude},${record.latitude}`}
              target="_blank"
              rel="noreferrer"
              className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-brand-600 hover:underline"
            >
              <MapPin className="size-3" />
              <span className="font-mono tabular-nums">
                {record.latitude.toFixed(5)}, {record.longitude.toFixed(5)}
              </span>
              {record.accuracy_m != null && (
                <span className="text-slate-400">±{Math.round(record.accuracy_m)}m</span>
              )}
            </a>
          )}

          {/* Notes */}
          {record.notes && (
            <p className="mt-1 text-[11px] text-slate-600">{record.notes}</p>
          )}
        </div>

        {/* Selfie */}
        {record.selfie_url ? (
          <a
            href={record.selfie_url}
            target="_blank"
            rel="noreferrer"
            className="block size-20 shrink-0 overflow-hidden rounded-lg ring-1 ring-slate-200 transition hover:ring-2 hover:ring-brand-300"
          >
            <img
              src={record.selfie_url}
              alt=""
              className="size-full object-cover"
            />
          </a>
        ) : (
          <div className="flex size-20 shrink-0 flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-slate-400">
            <Camera className="size-4" />
            <span className="mt-0.5 text-[9px] uppercase tracking-wide">
              {t("attendance.live_no_selfie")}
            </span>
          </div>
        )}
      </div>
    </li>
  );
}

function badgeTone(
  s: DailyOverviewRow["shift_status"]
): "success" | "warning" | "danger" | "info" | "default" {
  switch (s) {
    case "IN_PROGRESS":
      return "info";
    case "PRESENT":
      return "success";
    case "LATE":
      return "warning";
    case "ABSENT":
      return "danger";
    case "ON_LEAVE":
      return "info";
    case "REST_DAY":
    case "NOT_SCHEDULED":
    default:
      return "default";
  }
}

function Tile({
  icon,
  label,
  value,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-md bg-slate-50 px-2.5 py-1.5",
        highlight && "bg-emerald-50 ring-1 ring-emerald-200"
      )}
    >
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-wide text-slate-500">
        {icon}
        {label}
      </div>
      <div
        className={cn(
          "mt-0.5 truncate font-mono text-xs font-semibold",
          highlight ? "text-emerald-800" : "text-slate-700"
        )}
      >
        {value}
      </div>
    </div>
  );
}
