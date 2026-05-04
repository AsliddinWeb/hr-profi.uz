import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  CheckCircle2,
  FileEdit,
  MapPin,
  ScanFace,
  Smartphone,
  QrCode,
  Save,
  Trash2,
  X,
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
  Employee,
} from "@/lib/types";

void cn; // referenced by inline classnames below — kept explicit

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

/** Right-side drawer with full record details + admin edit panel.
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
    <div className="fixed inset-0 z-50 flex">
      <div
        className="flex-1 bg-slate-900/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <aside className="flex h-full w-full max-w-md flex-col overflow-hidden bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-800">
              {t("attendance.record_details")}
            </h2>
            <p className="text-xs text-slate-500">
              {ts.toLocaleString(i18n.language)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="space-y-5">
            {/* Employee */}
            <Section title={t("attendance.employee")}>
              {employee ? (
                <div className="flex items-center gap-3">
                  {employee.photo_url ? (
                    <img
                      src={employee.photo_url}
                      alt=""
                      className="size-10 rounded-full object-cover ring-1 ring-slate-200"
                    />
                  ) : (
                    <div className="flex size-10 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">
                      {employee.full_name
                        .split(/\s+/)
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((w) => w[0]?.toUpperCase() ?? "")
                        .join("")}
                    </div>
                  )}
                  <div>
                    <div className="text-sm font-medium text-slate-800">
                      {employee.full_name}
                    </div>
                    <div className="text-xs text-slate-500">
                      {employee.position} · {employee.employee_code}
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
            <Section title={t("attendance.type")}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={record.check_type === "CHECK_IN" ? "success" : "info"}>
                  {label("check_type", record.check_type)}
                </Badge>
                <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
                  <Icon className="size-3.5" />
                  {label("attendance_method", record.method)}
                </span>
              </div>
            </Section>

            {/* Selfie */}
            {record.selfie_url && (
              <Section title={t("attendance.selfie")}>
                <img
                  src={record.selfie_url}
                  alt=""
                  className="max-h-64 rounded-lg border border-slate-200 object-cover"
                />
                {record.face_match_score && (
                  <p className="mt-1 text-xs text-slate-500">
                    {t("attendance.score")}:{" "}
                    <span className="font-mono">
                      {Number(record.face_match_score).toFixed(2)}
                    </span>
                  </p>
                )}
              </Section>
            )}

            {/* Timing */}
            <Section title={t("attendance.timing")}>
              <div className="grid grid-cols-2 gap-2">
                <Tile label={t("attendance.late_min")} value={record.late_minutes} unit="m" tone={record.late_minutes > 0 ? "amber" : "slate"} />
                <Tile label={t("attendance.overtime_min")} value={record.overtime_minutes} unit="m" tone={record.overtime_minutes > 0 ? "emerald" : "slate"} />
              </div>
            </Section>

            {/* Location */}
            {record.latitude != null && record.longitude != null && (
              <Section title={t("attendance.location")}>
                <a
                  href={`https://yandex.com/maps/?ll=${record.longitude},${record.latitude}&z=17&pt=${record.longitude},${record.latitude}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md bg-slate-50 px-3 py-2 text-xs text-brand-600 hover:bg-slate-100"
                >
                  <MapPin className="size-3.5" />
                  <span className="font-mono">
                    {record.latitude.toFixed(6)}, {record.longitude.toFixed(6)}
                  </span>
                </a>
                {record.accuracy_m != null && (
                  <p className="mt-1 text-xs text-slate-500">
                    {t("attendance.accuracy")}: ±{record.accuracy_m}m
                  </p>
                )}
              </Section>
            )}

            {/* Status + notes (editable) */}
            <Section
              title={t("attendance.admin_review")}
              right={
                !editing && (
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className="text-xs text-brand-600 hover:underline"
                  >
                    {t("common.edit")}
                  </button>
                )
              }
            >
              {!editing ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">{t("attendance.status")}:</span>
                    <Badge tone={status === "VALID" ? "success" : status === "SUSPICIOUS" ? "warning" : "danger"}>
                      {label("attendance_status", status)}
                    </Badge>
                  </div>
                  {record.notes ? (
                    <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-700 whitespace-pre-wrap">
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
            <Section title={t("attendance.danger_zone")}>
              <div className="rounded-md border border-rose-200 bg-rose-50 p-3">
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
      </aside>
    </div>
  );
}

function Section({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          {title}
        </h3>
        {right}
      </div>
      {children}
    </div>
  );
}

function Tile({
  label,
  value,
  unit,
  tone,
}: {
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
    <div className={cn("rounded-md border px-3 py-2", cls)}>
      <div className="text-[10px] uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-0.5 text-base font-semibold tabular-nums">
        {value}
        {unit && <span className="ml-0.5 text-xs opacity-70">{unit}</span>}
      </div>
    </div>
  );
}
