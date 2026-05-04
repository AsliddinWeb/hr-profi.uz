import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Activity,
  CalendarRange,
  Clock,
  Coins,
  Sparkles,
  Wallet,
} from "lucide-react";

import { api } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import type {
  AttendanceRecord,
  Company,
  Employee,
  Page,
  SalaryTodaySnapshot,
  ShiftTemplate,
} from "@/lib/types";

interface Props {
  employee: Employee;
}

/** Effective hourly rate. For DAILY/MONTHLY pay we need to know how many hours
 * a "day" is and how many "days" a month — we read those from the employee's
 * shift template (if any) and the company's working_days setting (if any). */
function effectiveHourly(
  emp: Employee,
  hoursPerDay: number,
  daysPerMonth: number
): number {
  if (emp.salary_type === "HOURLY" && emp.hourly_rate) {
    return Number(emp.hourly_rate) || 0;
  }
  if (emp.salary_type === "DAILY" && emp.daily_rate) {
    return (Number(emp.daily_rate) || 0) / hoursPerDay;
  }
  if (emp.salary_type === "MONTHLY" && emp.base_salary) {
    return (Number(emp.base_salary) || 0) / daysPerMonth / hoursPerDay;
  }
  return 0;
}

interface TodayBreakdown {
  /** Worked-hours since the employee's first check-in today, including any
   * still-open in-progress segment. */
  workedHours: number;
  /** True iff the latest record is an unpaired CHECK_IN. */
  inProgress: boolean;
  /** UTC ms when the in-progress segment started. */
  inProgressSinceMs: number | null;
  /** Closed segments (pairs of CHECK_IN/CHECK_OUT) in hours. */
  closedHours: number;
}

function summariseToday(records: AttendanceRecord[]): TodayBreakdown {
  // Records arrive sorted desc by timestamp from the API; sort ascending here.
  const asc = [...records].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  let closedMs = 0;
  let openSinceMs: number | null = null;
  for (const r of asc) {
    const t = new Date(r.timestamp).getTime();
    if (r.check_type === "CHECK_IN") {
      // If we already had an open segment, that's a data anomaly (two
      // check-ins in a row). Replace it — assume the latest is authoritative.
      openSinceMs = t;
    } else if (r.check_type === "CHECK_OUT" && openSinceMs != null) {
      closedMs += t - openSinceMs;
      openSinceMs = null;
    }
  }
  const closedHours = closedMs / 3_600_000;
  if (openSinceMs == null) {
    return {
      workedHours: closedHours,
      inProgress: false,
      inProgressSinceMs: null,
      closedHours,
    };
  }
  const elapsedHours = (Date.now() - openSinceMs) / 3_600_000;
  return {
    workedHours: closedHours + Math.max(0, elapsedHours),
    inProgress: true,
    inProgressSinceMs: openSinceMs,
    closedHours,
  };
}

function fmtMoney(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("ru-RU").replace(/,/g, " ");
}

function fmtHours(h: number): string {
  if (!Number.isFinite(h) || h <= 0) return "0:00";
  const totalMin = Math.floor(h * 60);
  const hh = Math.floor(totalMin / 60);
  const mm = totalMin % 60;
  return `${hh}:${String(mm).padStart(2, "0")}`;
}

function formatTime(iso: string | null, locale: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function LiveEarningsCard({ employee }: Props) {
  const { t, i18n } = useTranslation();
  const todayIso = new Date().toISOString().slice(0, 10);

  // Pull the employee's shift template (for expected_hours) and the company's
  // working_days setting — same logic as the Compensation preview, so the live
  // hourly rate matches what the admin sees in the form.
  const templateQ = useQuery({
    queryKey: ["shift-templates", "for-live", employee.id],
    queryFn: async () =>
      (await api.get<{ items: ShiftTemplate[] }>("/shifts/templates", { params: { size: 100 } }))
        .data.items,
    staleTime: 60_000,
  });
  const companyQ = useQuery({
    queryKey: ["company", "me"],
    queryFn: async () => (await api.get<Company>("/companies/me")).data,
    staleTime: 60_000,
  });

  const hoursPerDay = useMemo(() => {
    const tpl = templateQ.data?.find((t) => t.id === employee.shift_template_id);
    const raw = tpl?.expected_hours;
    if (!raw) return 8;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 8;
  }, [templateQ.data, employee.shift_template_id]);

  const daysPerMonth = useMemo(() => {
    const wd = (companyQ.data?.settings as { working_days?: unknown } | undefined)?.working_days;
    if (Array.isArray(wd) && wd.length > 0) return Math.round(wd.length * 4.33);
    return 22;
  }, [companyQ.data]);

  // Today's attendance for THIS employee. Polled every 30 s in case a remote
  // device sends a fresh check-in/out; the in-progress segment ticks live in a
  // separate effect below.
  const attendanceQ = useQuery({
    queryKey: ["employee", "today-attendance", employee.id, todayIso],
    queryFn: async () =>
      (
        await api.get<Page<AttendanceRecord>>("/attendance/records", {
          params: {
            size: 50,
            employee_id: employee.id,
            from: todayIso,
            to: todayIso,
          },
        })
      ).data,
    refetchInterval: 30_000,
  });

  // Server snapshot of today's accrual + this month's period.
  const snapshotQ = useQuery({
    queryKey: ["salary", "employee-today", employee.id],
    queryFn: async () =>
      (await api.get<SalaryTodaySnapshot>(`/salary/employee/${employee.id}/today`)).data,
    refetchInterval: 60_000,
  });

  // Tick a clock state every second so the in-progress segment recomputes.
  const [, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const records = attendanceQ.data?.items ?? [];
  const todayBreakdown = useMemo(() => summariseToday(records), [records]);
  const hourly = useMemo(
    () => effectiveHourly(employee, hoursPerDay, daysPerMonth),
    [employee, hoursPerDay, daysPerMonth]
  );
  const liveTodayEarned = todayBreakdown.workedHours * hourly;
  const lastCheckIn = useMemo(() => {
    const inRecords = records.filter((r) => r.check_type === "CHECK_IN");
    if (inRecords.length === 0) return null;
    return inRecords.reduce((a, b) =>
      new Date(a.timestamp) > new Date(b.timestamp) ? a : b
    );
  }, [records]);
  const lastCheckOut = useMemo(() => {
    const outRecords = records.filter((r) => r.check_type === "CHECK_OUT");
    if (outRecords.length === 0) return null;
    return outRecords.reduce((a, b) =>
      new Date(a.timestamp) > new Date(b.timestamp) ? a : b
    );
  }, [records]);

  const monthEarned = snapshotQ.data?.period
    ? Number(snapshotQ.data.period.total_earned) || 0
    : 0;
  const monthPending = snapshotQ.data
    ? Number(snapshotQ.data.pending_amount) || 0
    : 0;

  const noRate = hourly <= 0;

  return (
    <Card>
      <div className="space-y-4 p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
              <Sparkles className="size-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-slate-700">
                {t("employees.live_title")}
              </h2>
              <p className="text-xs text-slate-500">
                {t("employees.live_hint")}
              </p>
            </div>
          </div>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold",
              todayBreakdown.inProgress
                ? "bg-emerald-100 text-emerald-700"
                : "bg-slate-100 text-slate-500"
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                todayBreakdown.inProgress
                  ? "bg-emerald-500 animate-pulse"
                  : "bg-slate-400"
              )}
            />
            {todayBreakdown.inProgress
              ? t("employees.live_status_active")
              : t("employees.live_status_idle")}
          </span>
        </div>

        {noRate ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {t("employees.live_no_rate")}
          </div>
        ) : (
          <>
            {/* Hero: today's live amount on a green gradient */}
            <div className="rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 p-5 text-white shadow-lg shadow-emerald-200">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-emerald-50/80">
                <Activity className="size-3.5" />
                {t("employees.live_today_earned")}
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-3xl font-bold tabular-nums">
                  {fmtMoney(liveTodayEarned)}
                </span>
                <span className="text-sm text-emerald-100">
                  {t("employees.currency_short")}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-emerald-50/90">
                <div>
                  <div className="opacity-70">{t("employees.live_worked")}</div>
                  <div className="font-semibold tabular-nums">
                    {fmtHours(todayBreakdown.workedHours)}
                  </div>
                </div>
                <div>
                  <div className="opacity-70">{t("employees.live_check_in")}</div>
                  <div className="font-semibold tabular-nums">
                    {formatTime(lastCheckIn?.timestamp ?? null, i18n.language)}
                  </div>
                </div>
                <div>
                  <div className="opacity-70">{t("employees.live_check_out")}</div>
                  <div className="font-semibold tabular-nums">
                    {formatTime(lastCheckOut?.timestamp ?? null, i18n.language)}
                  </div>
                </div>
              </div>
            </div>

            {/* Side stats */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <SideTile
                icon={<Clock className="size-4" />}
                label={t("employees.live_hourly_rate")}
                value={fmtMoney(hourly)}
                suffix={t("employees.currency_per_hour")}
              />
              <SideTile
                icon={<CalendarRange className="size-4" />}
                label={t("employees.live_month_total")}
                value={fmtMoney(monthEarned)}
                suffix={t("employees.currency_short")}
              />
              <SideTile
                icon={<Wallet className="size-4" />}
                label={t("employees.live_month_pending")}
                value={fmtMoney(monthPending)}
                suffix={t("employees.currency_short")}
              />
            </div>

            <p className="text-[11px] text-slate-400">
              <Coins className="mr-1 inline size-3" />
              {t("employees.live_disclaimer")}
            </p>
          </>
        )}
      </div>
    </Card>
  );
}

function SideTile({
  icon,
  label,
  value,
  suffix,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  suffix?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-500">
        {icon}
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-base font-semibold tabular-nums text-slate-800">
          {value}
        </span>
        {suffix && <span className="text-[11px] text-slate-500">{suffix}</span>}
      </div>
    </div>
  );
}
