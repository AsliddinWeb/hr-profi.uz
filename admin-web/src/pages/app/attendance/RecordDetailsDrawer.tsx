import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clock,
  Compass,
  ExternalLink,
  FileEdit,
  MapPin,
  Save,
  ScanFace,
  Smartphone,
  Sparkles,
  StickyNote,
  Target,
  Trash2,
  TrendingUp,
  X,
  QrCode,
} from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useEnumLabel } from "@/lib/enum";
import { cn } from "@/lib/cn";
import type {
  AttendanceMethod,
  AttendanceRecord,
  AttendanceRecordStatus,
  Branch,
  Employee,
} from "@/lib/types";

const METHOD_ICON: Record<AttendanceMethod, React.ComponentType<{ className?: string }>> = {
  MOBILE_APP: Smartphone,
  FACE_DEVICE: ScanFace,
  QR_CODE: QrCode,
  MANUAL: FileEdit,
};

interface Props {
  open: boolean;
  record: AttendanceRecord | null;
  employee?: Employee;
  onClose: () => void;
}

/** Centred modal with full record details + admin edit panel.
 *
 * Only ``status`` and ``notes`` are editable; timestamp / check_type stay
 * immutable so payroll runs against the original audit trail. */
export function RecordDetailsDrawer({ open, record, employee, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const label = useEnumLabel();
  const qc = useQueryClient();

  const [status, setStatus] = useState<AttendanceRecordStatus>("VALID");
  const [notes, setNotes] = useState("");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (record) {
      setStatus(record.status);
      setNotes(record.notes ?? "");
      setEditing(false);
    }
  }, [record]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Resolve the branch so we can show the geofence diagnosis (distance,
  // inside/outside, configured radius). For face-ID records the device's
  // branch is the source of truth; for mobile we use the employee's
  // assigned branch.
  const branchId = record?.branch_id ?? employee?.branch_id ?? null;
  const branchQ = useQuery({
    queryKey: ["branch", branchId],
    queryFn: async () => (await api.get<Branch>(`/branches/${branchId}`)).data,
    enabled: open && !!branchId,
  });

  const distance = useMemo(() => {
    if (
      !record ||
      record.latitude == null ||
      record.longitude == null ||
      !branchQ.data ||
      branchQ.data.latitude == null ||
      branchQ.data.longitude == null
    ) {
      return null;
    }
    return haversineMeters(
      Number(record.latitude),
      Number(record.longitude),
      branchQ.data.latitude,
      branchQ.data.longitude
    );
  }, [record, branchQ.data]);

  const patchMut = useMutation({
    mutationFn: async () => {
      if (!record) return;
      await api.patch(`/attendance/records/${record.id}`, {
        status,
        notes: notes.trim() || null,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["attendance"] });
      setEditing(false);
    },
  });

  const rejectMut = useMutation({
    mutationFn: async () => {
      if (!record) return;
      await api.delete(`/attendance/records/${record.id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["attendance"] });
      onClose();
    },
  });

  if (!open || !record) return null;
  const Icon = METHOD_ICON[record.method] ?? FileEdit;
  const ts = new Date(record.timestamp);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 py-8 backdrop-blur-sm">
      <div
        className="absolute inset-0"
        onClick={onClose}
        aria-hidden
      />

      <div
        className="relative my-auto w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 bg-gradient-to-r from-brand-50 to-white px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-brand-100 text-brand-700">
              <Icon className="size-5" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                {t("attendance.record_details")}
              </h2>
              <p className="text-xs text-slate-500">
                {ts.toLocaleString(i18n.language, {
                  year: "numeric",
                  month: "short",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            <X className="size-5" />
          </button>
        </header>

        {/* Status banner — derives from status + late + geofence diagnosis */}
        <StatusBanner record={record} distance={distance} branch={branchQ.data} />

        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Employee */}
            <Section icon={<Sparkles className="size-3.5" />} title={t("attendance.employee")}>
              {employee ? (
                <div className="flex items-center gap-3">
                  {employee.photo_url ? (
                    <img
                      src={employee.photo_url}
                      alt=""
                      className="size-10 rounded-full object-cover ring-1 ring-slate-200"
                    />
                  ) : (
                    <div className="flex size-10 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-700">
                      {employee.full_name
                        .split(/\s+/)
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((w) => w[0]?.toUpperCase() ?? "")
                        .join("")}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-900">
                      {employee.full_name}
                    </div>
                    <div className="truncate text-xs text-slate-500">
                      {employee.position}
                      {employee.position && employee.employee_code && " · "}
                      {employee.employee_code && (
                        <span className="font-mono">{employee.employee_code}</span>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="font-mono text-xs text-slate-500">
                  {record.employee_id.slice(0, 8)}…
                </p>
              )}
            </Section>

            {/* Type / method */}
            <Section icon={<FileEdit className="size-3.5" />} title={t("attendance.type")}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={record.check_type === "CHECK_IN" ? "success" : "info"}>
                  {label("check_type", record.check_type)}
                </Badge>
                <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                  <Icon className="size-3" />
                  {label("attendance_method", record.method)}
                </span>
              </div>
            </Section>

            {/* Timing */}
            <Section icon={<Clock className="size-3.5" />} title={t("attendance.timing")} className="lg:col-span-2">
              <div className="grid grid-cols-2 gap-2">
                <Tile
                  icon={<Clock className="size-3.5" />}
                  label={t("attendance.late_min")}
                  value={record.late_minutes}
                  unit="m"
                  tone={record.late_minutes > 0 ? "amber" : "slate"}
                />
                <Tile
                  icon={<TrendingUp className="size-3.5" />}
                  label={t("attendance.overtime_min")}
                  value={record.overtime_minutes}
                  unit="m"
                  tone={record.overtime_minutes > 0 ? "emerald" : "slate"}
                />
              </div>
            </Section>

            {/* Selfie */}
            {record.selfie_url && (
              <Section
                icon={<ScanFace className="size-3.5" />}
                title={t("attendance.selfie")}
                className="lg:col-span-2"
              >
                <div className="flex flex-wrap items-start gap-3">
                  <img
                    src={record.selfie_url}
                    alt=""
                    className="max-h-40 rounded-lg border border-slate-200 object-cover"
                  />
                  {record.face_match_score != null && (
                    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                      <div className="text-[10px] uppercase tracking-wide text-slate-500">
                        {t("attendance.score")}
                      </div>
                      <div className="text-lg font-bold tabular-nums text-slate-800">
                        {(Number(record.face_match_score) * 100).toFixed(0)}%
                      </div>
                    </div>
                  )}
                </div>
              </Section>
            )}

            {/* Location + geofence diagnosis */}
            {record.latitude != null && record.longitude != null && (
              <Section
                icon={<MapPin className="size-3.5" />}
                title={t("attendance.location")}
                className="lg:col-span-2"
              >
                <LocationBlock
                  record={record}
                  branch={branchQ.data}
                  distance={distance}
                />
              </Section>
            )}

            {/* Status + notes (editable) */}
            <Section
              icon={<StickyNote className="size-3.5" />}
              title={t("attendance.admin_review")}
              className="lg:col-span-2"
              right={
                !editing && (
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-100"
                  >
                    <FileEdit className="size-3" />
                    {t("common.edit")}
                  </button>
                )
              }
            >
              {!editing ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">{t("attendance.status")}:</span>
                    <Badge
                      tone={
                        status === "VALID"
                          ? "success"
                          : status === "SUSPICIOUS"
                            ? "warning"
                            : "danger"
                      }
                    >
                      {label("attendance_status", status)}
                    </Badge>
                  </div>
                  {record.notes ? (
                    <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs whitespace-pre-wrap text-slate-700">
                      {record.notes}
                    </p>
                  ) : (
                    <p className="text-xs text-slate-400">{t("attendance.no_notes")}</p>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="label">{t("attendance.status")}</label>
                    <select
                      className="input"
                      value={status}
                      onChange={(e) => setStatus(e.target.value as AttendanceRecordStatus)}
                    >
                      <option value="VALID">{label("attendance_status", "VALID")}</option>
                      <option value="SUSPICIOUS">
                        {label("attendance_status", "SUSPICIOUS")}
                      </option>
                      <option value="REJECTED">{label("attendance_status", "REJECTED")}</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">{t("attendance.notes")}</label>
                    <textarea
                      className="input min-h-[88px] resize-y py-2"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder={t("attendance.notes_placeholder") ?? ""}
                      maxLength={500}
                    />
                  </div>
                  {patchMut.isError && (
                    <p className="text-xs text-red-600">{apiErrorMessage(patchMut.error)}</p>
                  )}
                  {patchMut.isSuccess && (
                    <p className="inline-flex items-center gap-1 text-xs text-emerald-700">
                      <CheckCircle2 className="size-3.5" /> {t("common.save_changes")} ✓
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        setStatus(record.status);
                        setNotes(record.notes ?? "");
                        setEditing(false);
                      }}
                    >
                      {t("common.cancel")}
                    </Button>
                    <Button
                      type="button"
                      onClick={() => patchMut.mutate()}
                      loading={patchMut.isPending}
                    >
                      <Save className="size-4" />
                      {t("common.save_changes")}
                    </Button>
                  </div>
                </div>
              )}
            </Section>

            {/* Danger zone */}
            <Section
              icon={<AlertTriangle className="size-3.5" />}
              title={t("attendance.danger_zone")}
              className="lg:col-span-2"
            >
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
                <p className="flex items-start gap-2 text-xs text-rose-800">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  {t("attendance.reject_warning")}
                </p>
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  className="mt-2"
                  onClick={() => {
                    if (window.confirm(t("attendance.reject_confirm") || "Reject?")) {
                      rejectMut.mutate();
                    }
                  }}
                  loading={rejectMut.isPending}
                >
                  <Trash2 className="size-4" />
                  {t("attendance.reject_record")}
                </Button>
              </div>
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Geofence diagnosis banner — appears under the header when we can    */
/* determine inside/outside.                                           */
/* ------------------------------------------------------------------ */

function StatusBanner({
  record,
  distance,
  branch,
}: {
  record: AttendanceRecord;
  distance: number | null;
  branch?: Branch;
}) {
  const { t } = useTranslation();

  const tone = record.status === "VALID"
    ? "emerald"
    : record.status === "SUSPICIOUS"
      ? "amber"
      : "rose";
  const inside =
    distance != null && branch && distance <= branch.geofence_radius_m;

  const cls = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    rose: "border-rose-200 bg-rose-50 text-rose-800",
  }[tone];

  return (
    <div className={cn("border-b px-6 py-2.5 text-xs", cls)}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="inline-flex items-center gap-1.5 font-semibold">
          {tone === "emerald" ? (
            <CheckCircle2 className="size-3.5" />
          ) : tone === "amber" ? (
            <AlertTriangle className="size-3.5" />
          ) : (
            <X className="size-3.5" />
          )}
          {tone === "emerald"
            ? t("attendance.banner_valid")
            : tone === "amber"
              ? t("attendance.banner_suspicious")
              : t("attendance.banner_rejected")}
        </span>
        {distance != null && branch != null && (
          <span className="inline-flex items-center gap-1.5">
            <Compass className="size-3.5" />
            {inside
              ? t("attendance.banner_inside_geofence", {
                  distance: Math.round(distance),
                })
              : t("attendance.banner_outside_geofence", {
                  distance: Math.round(distance),
                  radius: branch.geofence_radius_m,
                })}
          </span>
        )}
        {record.late_minutes > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <Clock className="size-3.5" />
            {t("attendance.banner_late", { min: record.late_minutes })}
          </span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Location block — coordinates, branch reference, computed distance,  */
/* and quick-jump to Yandex / Google maps.                             */
/* ------------------------------------------------------------------ */

function LocationBlock({
  record,
  branch,
  distance,
}: {
  record: AttendanceRecord;
  branch?: Branch;
  distance: number | null;
}) {
  const { t } = useTranslation();
  if (record.latitude == null || record.longitude == null) return null;

  const inside =
    distance != null && branch && distance <= branch.geofence_radius_m;
  const accuracyLabel =
    record.accuracy_m != null
      ? `±${Number(record.accuracy_m).toFixed(0)}m`
      : null;

  return (
    <div className="space-y-3">
      {/* Coordinate strip */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-700">
          <MapPin className="size-3.5 text-brand-600" />
          {Number(record.latitude).toFixed(6)},{" "}
          {Number(record.longitude).toFixed(6)}
        </span>
        {accuracyLabel && (
          <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
            <Target className="size-3" />
            {t("attendance.accuracy")}: {accuracyLabel}
          </span>
        )}
        <a
          href={`https://yandex.com/maps/?ll=${record.longitude},${record.latitude}&z=18&pt=${record.longitude},${record.latitude}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-brand-700"
        >
          <ExternalLink className="size-3" />
          Yandex
        </a>
        <a
          href={`https://www.google.com/maps?q=${record.latitude},${record.longitude}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-md bg-sky-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-sky-700"
        >
          <ExternalLink className="size-3" />
          Google
        </a>
      </div>

      {/* Geofence diagnosis */}
      {branch != null && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <DiagTile
            icon={<Building2 className="size-3.5" />}
            label={t("attendance.diag_branch")}
            value={branch.name}
          />
          <DiagTile
            icon={<Compass className="size-3.5" />}
            label={t("attendance.diag_distance")}
            value={distance != null ? `${Math.round(distance)}m` : "—"}
            tone={
              distance == null
                ? "slate"
                : inside
                  ? "emerald"
                  : "rose"
            }
          />
          <DiagTile
            icon={<Target className="size-3.5" />}
            label={t("attendance.diag_radius")}
            value={`${branch.geofence_radius_m}m`}
          />
          {distance != null && !inside && (
            <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 sm:col-span-3">
              <AlertTriangle className="mr-1 inline size-3.5" />
              {t("attendance.outside_geofence_explain", {
                excess: Math.round(distance - branch.geofence_radius_m),
              })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  icon,
  title,
  right,
  className,
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  right?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-slate-200 bg-white p-4 shadow-sm",
        className
      )}
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
          {icon}
          {title}
        </h3>
        {right}
      </div>
      {children}
    </section>
  );
}

function Tile({
  icon,
  label,
  value,
  unit,
  tone,
}: {
  icon?: React.ReactNode;
  label: string;
  value: number | string;
  unit?: string;
  tone: "amber" | "emerald" | "slate";
}) {
  const cls = {
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
    slate: "border-slate-200 bg-slate-50 text-slate-700",
  }[tone];
  return (
    <div className={cn("rounded-lg border px-3 py-2", cls)}>
      <div className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide opacity-70">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 text-base font-bold tabular-nums">
        {value}
        {unit && <span className="ml-0.5 text-xs opacity-70">{unit}</span>}
      </div>
    </div>
  );
}

function DiagTile({
  icon,
  label,
  value,
  tone = "slate",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "slate" | "emerald" | "rose";
}) {
  const cls = {
    slate: "border-slate-200 bg-slate-50 text-slate-700",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
    rose: "border-rose-200 bg-rose-50 text-rose-800",
  }[tone];
  return (
    <div className={cn("rounded-lg border px-3 py-2", cls)}>
      <div className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide opacity-70">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 truncate text-sm font-bold">{value}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Haversine — meters between two lat/lng points.                       */
/* ------------------------------------------------------------------ */
function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // earth radius in metres
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
