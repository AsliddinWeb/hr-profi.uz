import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Camera,
  CheckCircle2,
  Clock,
  FileEdit,
  LogIn,
  LogOut,
  MapPin,
  MessageSquare,
  QrCode,
  ScanFace,
  Search,
  Smartphone,
  Tablet,
  TrendingUp,
} from "lucide-react";

import { cn } from "@/lib/cn";

import { api, apiErrorMessage } from "@/lib/api";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/Table";
import { useEnumLabel } from "@/lib/enum";
import type {
  AttendanceMethod,
  AttendanceRecord,
  AttendanceRecordStatus,
  Branch,
  Employee,
  Page,
} from "@/lib/types";

import { RecordDetailsDrawer } from "./RecordDetailsDrawer";
import { fmtDurationShort, initialsOf } from "./utils";

const METHOD_ICON: Record<AttendanceMethod, React.ComponentType<{ className?: string }>> = {
  MOBILE_APP: Smartphone,
  FACE_DEVICE: ScanFace,
  KIOSK_TABLET: Tablet,
  QR_CODE: QrCode,
  MANUAL: FileEdit,
};

interface Filters {
  from: string;
  to: string;
  employee_id: string;
  branch_id: string;
  status: "" | AttendanceRecordStatus;
  check_type: "" | "CHECK_IN" | "CHECK_OUT";
  method: "" | AttendanceMethod;
  q: string;
}

const emptyFilters: Filters = {
  from: "",
  to: "",
  employee_id: "",
  branch_id: "",
  status: "",
  check_type: "",
  method: "",
  q: "",
};

export function RecordsTab() {
  const { t, i18n } = useTranslation();
  const label = useEnumLabel();
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [active, setActive] = useState<AttendanceRecord | null>(null);

  const empQ = useQuery({
    queryKey: ["employees", "for-attendance"],
    queryFn: async () =>
      (await api.get<Page<Employee>>("/employees", { params: { size: 200 } })).data,
  });
  const branchesQ = useQuery({
    queryKey: ["branches", "for-attendance"],
    queryFn: async () =>
      (await api.get<Page<Branch>>("/branches", { params: { size: 200 } })).data,
  });

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["attendance", "records", filters],
    queryFn: async () => {
      const params: Record<string, string> = { size: "200" };
      if (filters.from) params.from = filters.from;
      if (filters.to) params.to = filters.to;
      if (filters.employee_id) params.employee_id = filters.employee_id;
      if (filters.branch_id) params.branch_id = filters.branch_id;
      const r = await api.get<Page<AttendanceRecord>>("/attendance/records", {
        params,
      });
      // Server has no ?status / ?check_type / ?method filters yet — apply
      // client-side. The page is already capped at 200 so the cost is fine.
      let items = r.data.items;
      if (filters.status) items = items.filter((it) => it.status === filters.status);
      if (filters.check_type) items = items.filter((it) => it.check_type === filters.check_type);
      if (filters.method) items = items.filter((it) => it.method === filters.method);
      if (filters.q) {
        const q = filters.q.toLowerCase();
        const empById = new Map(empQ.data?.items.map((e) => [e.id, e]) ?? []);
        items = items.filter((it) => {
          const emp = empById.get(it.employee_id);
          return (
            emp?.full_name.toLowerCase().includes(q) ||
            (emp?.employee_code ?? "").toLowerCase().includes(q)
          );
        });
      }
      return { ...r.data, items };
    },
    refetchInterval: 30_000,
  });

  const employees = empQ.data?.items ?? [];
  const branches = branchesQ.data?.items ?? [];
  const empById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);
  const items = data?.items ?? [];

  const stats = useMemo(() => {
    let valid = 0;
    let suspicious = 0;
    let rejected = 0;
    for (const r of items) {
      if (r.status === "VALID") valid += 1;
      else if (r.status === "SUSPICIOUS") suspicious += 1;
      else rejected += 1;
    }
    return { total: items.length, valid, suspicious, rejected };
  }, [items]);

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) =>
    setFilters((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Input
          type="date"
          label={t("attendance.from")}
          value={filters.from}
          onChange={(e) => set("from", e.target.value)}
        />
        <Input
          type="date"
          label={t("attendance.to")}
          value={filters.to}
          onChange={(e) => set("to", e.target.value)}
        />
        <div>
          <label className="label">{t("employees.branch")}</label>
          <select
            className="input"
            value={filters.branch_id}
            onChange={(e) => set("branch_id", e.target.value)}
          >
            <option value="">— {t("attendance.all")} —</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{t("attendance.employee")}</label>
          <select
            className="input"
            value={filters.employee_id}
            onChange={(e) => set("employee_id", e.target.value)}
          >
            <option value="">— {t("attendance.all")} —</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.full_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{t("attendance.type")}</label>
          <select
            className="input"
            value={filters.check_type}
            onChange={(e) => set("check_type", e.target.value as Filters["check_type"])}
          >
            <option value="">— {t("attendance.all")} —</option>
            <option value="CHECK_IN">{label("check_type", "CHECK_IN")}</option>
            <option value="CHECK_OUT">{label("check_type", "CHECK_OUT")}</option>
          </select>
        </div>
        <div>
          <label className="label">{t("attendance.method")}</label>
          <select
            className="input"
            value={filters.method}
            onChange={(e) => set("method", e.target.value as Filters["method"])}
          >
            <option value="">— {t("attendance.all")} —</option>
            <option value="MOBILE_APP">{label("attendance_method", "MOBILE_APP")}</option>
            <option value="FACE_DEVICE">{label("attendance_method", "FACE_DEVICE")}</option>
            <option value="QR_CODE">{label("attendance_method", "QR_CODE")}</option>
            <option value="MANUAL">{label("attendance_method", "MANUAL")}</option>
          </select>
        </div>
        <div>
          <label className="label">{t("attendance.status")}</label>
          <select
            className="input"
            value={filters.status}
            onChange={(e) => set("status", e.target.value as Filters["status"])}
          >
            <option value="">— {t("attendance.all")} —</option>
            <option value="VALID">{label("attendance_status", "VALID")}</option>
            <option value="SUSPICIOUS">{label("attendance_status", "SUSPICIOUS")}</option>
            <option value="REJECTED">{label("attendance_status", "REJECTED")}</option>
          </select>
        </div>
        <div className="lg:col-start-4">
          <Input
            label={t("attendance.search_label")}
            placeholder={t("attendance.search_placeholder") ?? ""}
            value={filters.q}
            onChange={(e) => set("q", e.target.value)}
            prefix={<Search className="size-4" />}
          />
        </div>
      </div>

      {/* Mini stat strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniStat tone="brand" label={t("attendance.stat_records")} value={stats.total} />
        <MiniStat tone="emerald" label={label("attendance_status", "VALID")} value={stats.valid} />
        <MiniStat tone="amber" label={label("attendance_status", "SUSPICIOUS")} value={stats.suspicious} />
        <MiniStat tone="rose" label={label("attendance_status", "REJECTED")} value={stats.rejected} />
      </div>

      <Table className="min-w-[1080px]">
        <THead>
          <TR>
            <TH className="w-1" />
            <TH>{t("attendance.when")}</TH>
            <TH>{t("attendance.employee")}</TH>
            <TH>{t("attendance.type")}</TH>
            <TH>{t("attendance.method")}</TH>
            <TH>{t("attendance.event_col")}</TH>
            <TH>{t("attendance.signals")}</TH>
            <TH>{t("attendance.status")}</TH>
          </TR>
        </THead>
        <TBody>
          {isLoading ? (
            <TR>
              <TD colSpan={8} className="text-center text-sm text-slate-500">
                {t("common.loading")}
              </TD>
            </TR>
          ) : isError ? (
            <TR>
              <TD colSpan={8} className="text-center text-sm text-red-600">
                {apiErrorMessage(error)}
              </TD>
            </TR>
          ) : items.length === 0 ? (
            <TR>
              <TD colSpan={8} className="text-center text-sm text-slate-500">
                {t("common.no_data")}
              </TD>
            </TR>
          ) : (
            items.map((r) => {
              const Icon = METHOD_ICON[r.method] ?? FileEdit;
              const emp = empById.get(r.employee_id);
              const hasGps = r.latitude != null && r.longitude != null;
              const hasSelfie = !!r.selfie_url;
              const hasNotes = !!r.notes && r.notes.trim() !== "";
              const ts = new Date(r.timestamp);
              const isIn = r.check_type === "CHECK_IN";
              const isRejected = r.status === "REJECTED";
              // Status stripe along the left edge — VALID green, SUSPICIOUS amber, REJECTED rose
              const stripe =
                r.status === "VALID"
                  ? "bg-emerald-500"
                  : r.status === "SUSPICIOUS"
                  ? "bg-amber-500"
                  : "bg-rose-500";
              // Subtle row tint based on check_type so IN vs OUT scan apart
              // even before reading the type column.
              const rowTint = isRejected
                ? "bg-rose-50/30"
                : isIn
                ? "bg-emerald-50/20 hover:bg-emerald-50/50"
                : "bg-slate-50/30 hover:bg-slate-50";
              return (
                <TR
                  key={r.id}
                  className={cn(
                    "group cursor-pointer transition",
                    rowTint,
                    isRejected && "opacity-70"
                  )}
                  onClick={() => setActive(r)}
                >
                  <TD className="!w-1 !p-0">
                    <div className={`h-full w-1 ${stripe}`} />
                  </TD>
                  <TD>
                    <div className="font-mono text-base font-bold tabular-nums text-slate-900">
                      {ts.toLocaleTimeString(i18n.language, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                    <div className="text-[10px] text-slate-400 tabular-nums">
                      {ts.toLocaleDateString(i18n.language, {
                        day: "2-digit",
                        month: "short",
                      })}
                    </div>
                  </TD>
                  <TD className="font-medium">
                    <div className="flex items-center gap-2.5">
                      {emp?.photo_url ? (
                        <img
                          src={emp.photo_url}
                          alt=""
                          className="size-9 rounded-full object-cover ring-1 ring-slate-200"
                        />
                      ) : (
                        <span className="flex size-9 items-center justify-center rounded-full bg-brand-50 text-[10px] font-semibold text-brand-700">
                          {initialsOf(emp?.full_name ?? "•")}
                        </span>
                      )}
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-800">
                          {emp?.full_name ?? r.employee_id.slice(0, 8)}
                        </div>
                        <div className="truncate text-[11px] text-slate-400">
                          {emp?.position ?? emp?.employee_code ?? ""}
                        </div>
                      </div>
                    </div>
                  </TD>
                  <TD>
                    {/* Big colored type chip with arrow icon — at-a-glance IN/OUT */}
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-wide ring-1",
                        isIn
                          ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                          : "bg-slate-100 text-slate-700 ring-slate-200"
                      )}
                    >
                      {isIn ? (
                        <LogIn className="size-3.5" />
                      ) : (
                        <LogOut className="size-3.5" />
                      )}
                      {label("check_type", r.check_type)}
                    </span>
                  </TD>
                  <TD>
                    <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
                      <Icon className="size-3.5 text-slate-500" />
                      {label("attendance_method", r.method)}
                    </span>
                  </TD>
                  <TD>
                    {/* Context-aware: late only matters for IN, OT for OUT */}
                    {isIn ? (
                      r.late_minutes > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800 ring-1 ring-amber-200">
                          <Clock className="size-3" />
                          +{fmtDurationShort(r.late_minutes)} {t("attendance.live_late")}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200">
                          <CheckCircle2 className="size-3" />
                          {t("attendance.on_time")}
                        </span>
                      )
                    ) : r.overtime_minutes > 0 ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800 ring-1 ring-emerald-200">
                        <TrendingUp className="size-3" />
                        +{fmtDurationShort(r.overtime_minutes)} {t("attendance.live_overtime")}
                      </span>
                    ) : r.is_early_leave ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-800 ring-1 ring-rose-200">
                        <Clock className="size-3" />
                        {t("attendance.early_leave")}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </TD>
                  <TD>
                    <div className="flex items-center gap-1.5">
                      {hasGps && (
                        <span
                          className="inline-flex size-6 items-center justify-center rounded-md bg-emerald-50 ring-1 ring-emerald-200"
                          title={t("attendance.has_gps") ?? undefined}
                        >
                          <MapPin className="size-3.5 text-emerald-600" />
                        </span>
                      )}
                      {hasSelfie && (
                        <span
                          className="inline-flex size-6 items-center justify-center rounded-md bg-brand-50 ring-1 ring-brand-200"
                          title={t("attendance.has_selfie") ?? undefined}
                        >
                          <Camera className="size-3.5 text-brand-600" />
                        </span>
                      )}
                      {hasNotes && (
                        <span
                          className="inline-flex size-6 items-center justify-center rounded-md bg-slate-100 ring-1 ring-slate-200"
                          title={r.notes ?? undefined}
                        >
                          <MessageSquare className="size-3.5 text-slate-600" />
                        </span>
                      )}
                      {!hasGps && !hasSelfie && !hasNotes && (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </div>
                  </TD>
                  <TD>
                    <Badge
                      tone={
                        r.status === "VALID"
                          ? "success"
                          : r.status === "SUSPICIOUS"
                          ? "warning"
                          : "danger"
                      }
                    >
                      {label("attendance_status", r.status)}
                    </Badge>
                  </TD>
                </TR>
              );
            })
          )}
        </TBody>
      </Table>

      <RecordDetailsDrawer
        open={!!active}
        record={active}
        employee={active ? empById.get(active.employee_id) : undefined}
        onClose={() => setActive(null)}
      />
    </div>
  );
}

function MiniStat({
  tone,
  label,
  value,
}: {
  tone: "brand" | "emerald" | "amber" | "rose";
  label: string;
  value: number;
}) {
  const cls = {
    brand: "border-brand-200 bg-brand-50 text-brand-800",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    rose: "border-rose-200 bg-rose-50 text-rose-800",
  }[tone];
  return (
    <div className={`flex items-center justify-between rounded-lg border px-3 py-2 ${cls}`}>
      <span className="text-xs uppercase tracking-wide opacity-70">{label}</span>
      <span className="text-base font-bold tabular-nums">{value}</span>
    </div>
  );
}
