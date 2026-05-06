import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Building2,
  Clock,
  LogIn,
  LogOut,
  RefreshCw,
  Search,
  TrendingUp,
  UserCheck,
  UserX,
  Users,
  X,
} from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useEnumLabel } from "@/lib/enum";
import { cn } from "@/lib/cn";
import type { Branch, DailyOverviewRow, Page } from "@/lib/types";

import { fmtDurationShort, fmtHM, fmtTime, initialsOf } from "./utils";
import { LiveCardDetailsDialog } from "./LiveCardDetailsDialog";

/** Local YYYY-MM-DD for today (no UTC drift on date pickers). */
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function LiveTab() {
  const { t, i18n } = useTranslation();
  const label = useEnumLabel();
  const [query, setQuery] = useState("");
  const [branchFilter, setBranchFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [active, setActive] = useState<DailyOverviewRow | null>(null);
  // Selected date (defaults to today). When set to a past date we drop the
  // 30s live polling — historical data doesn't change.
  const [date, setDate] = useState<string>(todayIso());
  const isToday = date === todayIso();

  const branchesQ = useQuery({
    queryKey: ["branches", "for-attendance-live"],
    queryFn: async () =>
      (await api.get<Page<Branch>>("/branches", { params: { size: 200 } })).data,
  });

  const overviewQ = useQuery({
    queryKey: ["attendance", "daily-overview", date],
    queryFn: async () =>
      (
        await api.get<DailyOverviewRow[]>("/attendance/daily-overview", {
          params: isToday ? undefined : { date },
        })
      ).data,
    refetchInterval: isToday ? 30_000 : false,
    refetchIntervalInBackground: false,
    staleTime: 0,
    refetchOnMount: "always",
  });

  // Tick the visible "is currently in for X" durations every second so the UI
  // doesn't feel frozen between API polls.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const rows = overviewQ.data ?? [];
  const branches = branchesQ.data?.items ?? [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (branchFilter !== "all" && r.branch_id !== branchFilter) return false;
      if (statusFilter !== "all") {
        // The "IN_PROGRESS" chip means "currently inside the building",
        // not literally ``shift_status === IN_PROGRESS``. A late employee
        // who's still on the floor lands in shift_status=LATE but is also
        // currently in — the operator clicking the green "Hozir
        // ishlamoqda 4" pill expects to see those four cards. Match the
        // counter (``r.is_currently_in``) so chip count and chip click
        // are consistent.
        if (statusFilter === "IN_PROGRESS") {
          if (!r.is_currently_in) return false;
        } else if (r.shift_status !== statusFilter) {
          return false;
        }
      }
      if (
        q &&
        !r.full_name.toLowerCase().includes(q) &&
        !r.employee_code.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [rows, query, branchFilter, statusFilter]);

  const stats = useMemo(() => {
    const out = {
      total: rows.length,
      working: 0,
      present: 0,
      late: 0,
      absent: 0,
      on_leave: 0,
      rest: 0,
      not_scheduled: 0,
      ot_minutes: 0,
    };
    for (const r of rows) {
      if (r.is_currently_in) out.working += 1;
      if (r.shift_status === "PRESENT" || r.shift_status === "IN_PROGRESS")
        out.present += 1;
      if (r.shift_status === "LATE") out.late += 1;
      if (r.shift_status === "ABSENT") out.absent += 1;
      if (r.shift_status === "ON_LEAVE") out.on_leave += 1;
      if (r.shift_status === "REST_DAY") out.rest += 1;
      if (r.shift_status === "NOT_SCHEDULED") out.not_scheduled += 1;
      out.ot_minutes += r.overtime_minutes;
    }
    return out;
  }, [rows]);

  // Per-branch employee counts (only for branches that actually appear in
  // today's overview, plus an "all" tally) so the chip strip can show
  // "Branch (24)" like the requested layout.
  const branchCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      if (!r.branch_id) continue;
      map.set(r.branch_id, (map.get(r.branch_id) ?? 0) + 1);
    }
    return map;
  }, [rows]);

  // Show every active branch in the chip strip, even those with no
  // employees in today's overview, so the admin can always filter to
  // any branch (and see an empty list / "—" if it's idle). Inactive
  // (soft-deleted) branches only stay if employees are still attached
  // — otherwise they'd clutter the bar with permanent zero chips.
  const visibleBranches = useMemo(
    () =>
      branches.filter(
        (b) => b.is_active || (branchCounts.get(b.id) ?? 0) > 0
      ),
    [branches, branchCounts]
  );

  const hasFilters =
    query.trim() !== "" || branchFilter !== "all" || statusFilter !== "all";

  const showElapsedFor = (row: DailyOverviewRow): string => {
    if (!row.is_currently_in || !row.first_check_in) return fmtHM(row.minutes_worked);
    const startMs = new Date(row.first_check_in).getTime();
    const elapsed = (Date.now() - startMs) / 60_000;
    return fmtHM(elapsed);
  };

  return (
    <div className="space-y-5">
      {/* Stats strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile
          tone="brand"
          icon={<Users className="size-4" />}
          label={t("attendance.stat_total")}
          value={stats.total}
        />
        <StatTile
          tone="emerald"
          icon={<UserCheck className="size-4" />}
          label={t("attendance.stat_working")}
          value={stats.working}
        />
        <StatTile
          tone="emerald"
          icon={<LogIn className="size-4" />}
          label={t("attendance.stat_present")}
          value={stats.present}
        />
        <StatTile
          tone="amber"
          icon={<Clock className="size-4" />}
          label={t("attendance.stat_late")}
          value={stats.late}
        />
        <StatTile
          tone="rose"
          icon={<UserX className="size-4" />}
          label={t("attendance.stat_absent")}
          value={stats.absent}
        />
        <StatTile
          tone="slate"
          icon={<TrendingUp className="size-4" />}
          label={t("attendance.stat_overtime_today")}
          value={fmtHM(stats.ot_minutes)}
        />
      </div>

      {/* Filters: branch chips on top, then search + status pills + actions */}
      <div className="space-y-3">
        {/* Branch chip strip — only show branches present in today's overview
            so the bar stays tight on companies with many branches. */}
        <div className="flex flex-wrap items-center gap-2">
          <BranchChip
            active={branchFilter === "all"}
            onClick={() => setBranchFilter("all")}
            label={t("departments_page.branch_all")}
            count={rows.length}
            allChip
          />
          {visibleBranches.map((b) => (
            <BranchChip
              key={b.id}
              active={branchFilter === b.id}
              onClick={() => setBranchFilter(b.id)}
              label={b.name}
              count={branchCounts.get(b.id) ?? 0}
              disabled={!b.is_active}
            />
          ))}
        </div>

        {/* Search + date + actions row */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[260px] flex-1">
            <Input
              label={t("attendance.search_label")}
              placeholder={t("attendance.search_placeholder") ?? ""}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              prefix={<Search className="size-4" />}
            />
          </div>
          <Input
            type="date"
            label={t("attendance.date_label")}
            value={date}
            max={todayIso()}
            onChange={(e) => setDate(e.target.value || todayIso())}
            className="min-w-[160px]"
          />
          {!isToday && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setDate(todayIso())}
            >
              {t("attendance.jump_today")}
            </Button>
          )}
          {hasFilters && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setQuery("");
                setBranchFilter("all");
                setStatusFilter("all");
              }}
            >
              <X className="size-4" />
              {t("attendance.clear_filters")}
            </Button>
          )}
          <Button
            type="button"
            variant="secondary"
            onClick={() => overviewQ.refetch()}
            loading={overviewQ.isFetching}
          >
            <RefreshCw className="size-4" />
            {t("attendance.refresh")}
          </Button>
        </div>

        {/* Historical-mode banner — reminds the admin they're not seeing
            today's attendance, so they don't get confused by stale numbers. */}
        {!isToday && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {t("attendance.historical_hint", { date })}
          </div>
        )}

        {/* Status pills — each shows the count and uses its own tone, idle
            state has subtle tinted bg so the eye picks up the colour even
            without a selection. */}
        <div className="flex flex-wrap gap-2">
          <StatusPill
            active={statusFilter === "all"}
            onClick={() => setStatusFilter("all")}
            label={t("branches.status_all")}
            count={stats.total}
            tone="brand"
          />
          <StatusPill
            active={statusFilter === "IN_PROGRESS"}
            onClick={() => setStatusFilter("IN_PROGRESS")}
            label={label("shift_status_label", "IN_PROGRESS")}
            count={stats.working}
            tone="emerald"
            pulseDot
          />
          <StatusPill
            active={statusFilter === "PRESENT"}
            onClick={() => setStatusFilter("PRESENT")}
            label={label("shift_status_label", "PRESENT")}
            count={stats.present}
            tone="emerald"
          />
          <StatusPill
            active={statusFilter === "LATE"}
            onClick={() => setStatusFilter("LATE")}
            label={label("shift_status_label", "LATE")}
            count={stats.late}
            tone="amber"
          />
          <StatusPill
            active={statusFilter === "ABSENT"}
            onClick={() => setStatusFilter("ABSENT")}
            label={label("shift_status_label", "ABSENT")}
            count={stats.absent}
            tone="rose"
          />
          <StatusPill
            active={statusFilter === "ON_LEAVE"}
            onClick={() => setStatusFilter("ON_LEAVE")}
            label={label("shift_status_label", "ON_LEAVE")}
            count={stats.on_leave}
            tone="indigo"
          />
          <StatusPill
            active={statusFilter === "REST_DAY"}
            onClick={() => setStatusFilter("REST_DAY")}
            label={label("shift_status_label", "REST_DAY")}
            count={stats.rest}
            tone="slate"
          />
          <StatusPill
            active={statusFilter === "NOT_SCHEDULED"}
            onClick={() => setStatusFilter("NOT_SCHEDULED")}
            label={label("shift_status_label", "NOT_SCHEDULED")}
            count={stats.not_scheduled}
            tone="slate"
          />
        </div>
      </div>

      {/* Card grid — each employee gets a status-tinted card with live
          ticker. Click opens the per-employee day-detail modal. */}
      {overviewQ.isLoading ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          {t("common.loading")}
        </div>
      ) : overviewQ.isError ? (
        <p className="text-sm text-red-600">{apiErrorMessage(overviewQ.error)}</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          {t("common.no_data")}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((r) => (
            <EmployeeLiveCard
              key={r.employee_id}
              row={r}
              labelStatus={label("shift_status_label", r.shift_status)}
              elapsedLabel={showElapsedFor(r)}
              locale={i18n.language}
              t={t}
              onClick={() => setActive(r)}
            />
          ))}
        </div>
      )}

      <LiveCardDetailsDialog
        open={!!active}
        row={active}
        date={date}
        onClose={() => setActive(null)}
      />
    </div>
  );
}

// ---------------- Card --------------------------------------------------

type CardTone = "emerald" | "amber" | "rose" | "slate" | "indigo";

const STATUS_TONE: Record<string, CardTone> = {
  IN_PROGRESS: "emerald",
  PRESENT: "emerald",
  LATE: "amber",
  ABSENT: "rose",
  ON_LEAVE: "indigo",
  REST_DAY: "indigo",
  NOT_SCHEDULED: "slate",
};

const CARD_TONES: Record<
  CardTone,
  {
    accent: string; // left ribbon
    bg: string; // card bg
    border: string;
    hover: string;
    badge: "success" | "warning" | "danger" | "info" | "default";
    badgeText: string;
    badgeBg: string;
  }
> = {
  emerald: {
    accent: "bg-gradient-to-b from-emerald-400 to-emerald-600",
    bg: "bg-white",
    border: "border-slate-200",
    hover: "hover:border-emerald-300 hover:shadow-emerald-100",
    badge: "success",
    badgeText: "text-emerald-700",
    badgeBg: "bg-emerald-50 ring-emerald-200",
  },
  amber: {
    accent: "bg-gradient-to-b from-amber-400 to-amber-600",
    bg: "bg-amber-50/40",
    border: "border-amber-200",
    hover: "hover:border-amber-300 hover:shadow-amber-100",
    badge: "warning",
    badgeText: "text-amber-700",
    badgeBg: "bg-amber-100 ring-amber-200",
  },
  rose: {
    accent: "bg-gradient-to-b from-rose-400 to-rose-600",
    bg: "bg-gradient-to-br from-rose-50 to-rose-100/60",
    border: "border-rose-200",
    hover: "hover:border-rose-400 hover:shadow-rose-100",
    badge: "danger",
    badgeText: "text-rose-700",
    badgeBg: "bg-white ring-rose-200",
  },
  indigo: {
    accent: "bg-gradient-to-b from-indigo-300 to-indigo-500",
    bg: "bg-indigo-50/40",
    border: "border-indigo-200",
    hover: "hover:border-indigo-300 hover:shadow-indigo-100",
    badge: "info",
    badgeText: "text-indigo-700",
    badgeBg: "bg-white ring-indigo-200",
  },
  slate: {
    accent: "bg-gradient-to-b from-slate-300 to-slate-500",
    bg: "bg-white",
    border: "border-slate-200",
    hover: "hover:border-slate-300 hover:shadow-slate-200",
    badge: "default",
    badgeText: "text-slate-600",
    badgeBg: "bg-slate-100 ring-slate-200",
  },
};

function EmployeeLiveCard({
  row,
  labelStatus,
  elapsedLabel,
  locale,
  t,
  onClick,
}: {
  row: DailyOverviewRow;
  labelStatus: string;
  elapsedLabel: string;
  locale: string;
  t: (k: string) => string;
  onClick: () => void;
}) {
  // No check-in time recorded => force absent visuals regardless of the
  // server-side shift_status. REST_DAY, ON_LEAVE and NOT_SCHEDULED are
  // exempt — those are legitimate "no check-in needed" cases and must
  // not look like absences. NOT_SCHEDULED in particular is what the
  // backend returns for today-before-shift-end, so forcing red would
  // contradict the "Rejada yo'q" filter count.
  const isAbsent =
    !row.first_check_in &&
    row.shift_status !== "REST_DAY" &&
    row.shift_status !== "ON_LEAVE" &&
    row.shift_status !== "NOT_SCHEDULED";
  const toneKey: CardTone = isAbsent
    ? "rose"
    : STATUS_TONE[row.shift_status] ?? "slate";
  const c = CARD_TONES[toneKey];
  const displayLabel = isAbsent
    ? t("attendance.live_status_absent")
    : labelStatus;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative overflow-hidden rounded-xl border p-4 pl-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md",
        c.border,
        c.bg,
        c.hover
      )}
    >
      {/* Left accent ribbon — bolder than a top stripe and reads as an at-a-glance status */}
      <span className={cn("absolute inset-y-0 left-0 w-1.5", c.accent)} />

      <div className="flex items-start gap-3">
        <Avatar photo={row.photo_url} name={row.full_name} live={row.is_currently_in} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-slate-900 group-hover:text-brand-700">
            {row.full_name}
          </div>
          <div className="truncate text-[11px] text-slate-500">
            {row.position || row.employee_code}
          </div>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ring-1",
            c.badgeText,
            c.badgeBg
          )}
        >
          {row.is_currently_in && (
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
            </span>
          )}
          {displayLabel}
        </span>
      </div>

      {/* Times row */}
      <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
        <Tile
          tone="emerald"
          icon={<LogIn className="size-3" />}
          label={t("attendance.live_check_in")}
          value={fmtTime(row.first_check_in, locale)}
          missing={!row.first_check_in}
        />
        <Tile
          tone={row.is_currently_in ? "emerald" : "slate"}
          icon={<LogOut className="size-3" />}
          label={t("attendance.live_check_out")}
          value={
            row.is_currently_in
              ? t("attendance.still_in")
              : fmtTime(row.last_check_out, locale)
          }
          highlight={row.is_currently_in}
          missing={!row.is_currently_in && !row.last_check_out}
        />
        <Tile
          tone="brand"
          icon={<Clock className="size-3" />}
          label={t("attendance.live_worked")}
          value={elapsedLabel}
          highlight={row.is_currently_in}
        />
      </div>

      {/* Late / OT pills */}
      <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
        {row.late_minutes > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800 ring-1 ring-amber-200">
            <Clock className="size-3" />
            +{fmtDurationShort(row.late_minutes, {
              hour: t("attendance.unit_hour"),
              minute: t("attendance.unit_min"),
            })}{" "}
            {t("attendance.live_late")}
          </span>
        )}
        {row.overtime_minutes > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800 ring-1 ring-emerald-200">
            <TrendingUp className="size-3" />
            +{fmtDurationShort(row.overtime_minutes, {
              hour: t("attendance.unit_hour"),
              minute: t("attendance.unit_min"),
            })}{" "}
            {t("attendance.live_overtime")}
          </span>
        )}
        {!isAbsent && row.late_minutes === 0 && row.overtime_minutes === 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 ring-1 ring-emerald-200/70">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            {t("attendance.live_clean")}
          </span>
        )}
        {isAbsent && (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 font-semibold text-rose-700 ring-1 ring-rose-200">
            <UserX className="size-3" />
            {t("attendance.live_absent_hint")}
          </span>
        )}
      </div>
    </button>
  );
}

const TILE_TONE: Record<
  "emerald" | "slate" | "brand",
  { idle: string; iconIdle: string; highlight: string; iconHighlight: string }
> = {
  emerald: {
    idle: "bg-slate-50 text-slate-700",
    iconIdle: "text-emerald-500",
    highlight: "bg-emerald-50 ring-1 ring-emerald-200 text-emerald-800",
    iconHighlight: "text-emerald-600",
  },
  slate: {
    idle: "bg-slate-50 text-slate-700",
    iconIdle: "text-slate-500",
    highlight: "bg-slate-100 ring-1 ring-slate-200 text-slate-800",
    iconHighlight: "text-slate-600",
  },
  brand: {
    idle: "bg-brand-50/60 text-slate-700",
    iconIdle: "text-brand-500",
    highlight: "bg-brand-50 ring-1 ring-brand-200 text-brand-800",
    iconHighlight: "text-brand-600",
  },
};

function Tile({
  tone = "slate",
  icon,
  label,
  value,
  highlight,
  missing,
}: {
  tone?: "emerald" | "slate" | "brand";
  icon: React.ReactNode;
  label: string;
  value: string;
  highlight?: boolean;
  missing?: boolean;
}) {
  const c = TILE_TONE[tone];
  return (
    <div
      className={cn(
        "rounded-lg px-2 py-1.5",
        highlight ? c.highlight : c.idle,
        missing && "opacity-60"
      )}
    >
      <div className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider">
        <span className={cn(highlight ? c.iconHighlight : c.iconIdle)}>{icon}</span>
        <span className="text-slate-500">{label}</span>
      </div>
      <div className="mt-0.5 truncate font-mono text-sm font-bold text-slate-800">
        {value}
      </div>
    </div>
  );
}

function Avatar({
  photo,
  name,
  live,
}: {
  photo: string | null;
  name: string;
  live?: boolean;
}) {
  return (
    <div className="relative inline-block">
      {photo ? (
        <img
          src={photo}
          alt=""
          className="size-9 rounded-full object-cover ring-1 ring-slate-200"
        />
      ) : (
        <span className="flex size-9 items-center justify-center rounded-full bg-brand-50 text-[10px] font-semibold text-brand-700">
          {initialsOf(name) || "•"}
        </span>
      )}
      {live && (
        <span className="absolute -bottom-0.5 -right-0.5 flex size-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex size-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />
        </span>
      )}
    </div>
  );
}

function BranchChip({
  active,
  onClick,
  label,
  count,
  allChip,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  allChip?: boolean;
  /** Inactive branch — still selectable, but visually muted with a strike. */
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition",
        active
          ? "border-brand-600 bg-brand-600 text-white shadow-sm shadow-brand-600/30"
          : "border-slate-200 bg-white text-slate-700 hover:-translate-y-0.5 hover:border-brand-300 hover:bg-brand-50/50 hover:text-brand-700 hover:shadow-sm",
        disabled && !active && "opacity-50 line-through"
      )}
    >
      {allChip ? (
        <Users className={cn("size-3.5", active ? "opacity-90" : "text-brand-500")} />
      ) : (
        <Building2 className={cn("size-3.5", active ? "opacity-90" : "text-slate-400")} />
      )}
      <span className="truncate max-w-[180px]">{label}</span>
      <span
        className={cn(
          "inline-flex min-w-[20px] items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums no-underline",
          active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-700"
        )}
      >
        {count}
      </span>
    </button>
  );
}

const STATUS_PILL_TONE: Record<
  "brand" | "emerald" | "amber" | "rose" | "slate" | "indigo",
  {
    active: string;
    idle: string;
    badgeActive: string;
    badgeIdle: string;
    dot: string;
  }
> = {
  brand: {
    active: "bg-brand-600 text-white shadow-sm shadow-brand-600/30",
    idle: "bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200 hover:bg-brand-100",
    badgeActive: "bg-white/20 text-white",
    badgeIdle: "bg-white text-brand-700",
    dot: "bg-brand-500",
  },
  emerald: {
    active: "bg-emerald-600 text-white shadow-sm shadow-emerald-600/30",
    idle: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 hover:bg-emerald-100",
    badgeActive: "bg-white/20 text-white",
    badgeIdle: "bg-white text-emerald-700",
    dot: "bg-emerald-500",
  },
  amber: {
    active: "bg-amber-500 text-white shadow-sm shadow-amber-500/30",
    idle: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200 hover:bg-amber-100",
    badgeActive: "bg-white/20 text-white",
    badgeIdle: "bg-white text-amber-700",
    dot: "bg-amber-500",
  },
  rose: {
    active: "bg-rose-600 text-white shadow-sm shadow-rose-600/30",
    idle: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200 hover:bg-rose-100",
    badgeActive: "bg-white/20 text-white",
    badgeIdle: "bg-white text-rose-700",
    dot: "bg-rose-500",
  },
  slate: {
    active: "bg-slate-700 text-white shadow-sm shadow-slate-700/30",
    idle: "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-slate-200",
    badgeActive: "bg-white/20 text-white",
    badgeIdle: "bg-white text-slate-700",
    dot: "bg-slate-500",
  },
  indigo: {
    active: "bg-indigo-600 text-white shadow-sm shadow-indigo-600/30",
    idle: "bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200 hover:bg-indigo-100",
    badgeActive: "bg-white/20 text-white",
    badgeIdle: "bg-white text-indigo-700",
    dot: "bg-indigo-500",
  },
};

function StatusPill({
  active,
  onClick,
  label,
  count,
  tone,
  pulseDot,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  tone: "brand" | "emerald" | "amber" | "rose" | "slate" | "indigo";
  pulseDot?: boolean;
}) {
  const c = STATUS_PILL_TONE[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition",
        active ? c.active : c.idle
      )}
    >
      {pulseDot && (
        <span className="relative flex size-2">
          <span
            className={cn(
              "absolute inline-flex h-full w-full animate-ping rounded-full opacity-75",
              c.dot
            )}
          />
          <span className={cn("relative inline-flex size-2 rounded-full", c.dot)} />
        </span>
      )}
      <span>{label}</span>
      <span
        className={cn(
          "inline-flex min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums",
          active ? c.badgeActive : c.badgeIdle
        )}
      >
        {count}
      </span>
    </button>
  );
}

function StatTile({
  tone,
  icon,
  label,
  value,
}: {
  tone: "brand" | "emerald" | "amber" | "rose" | "slate";
  icon: React.ReactNode;
  label: string;
  value: string | number;
}) {
  const cls = {
    brand: "border-brand-200 bg-brand-50 text-brand-800",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    rose: "border-rose-200 bg-rose-50 text-rose-800",
    slate: "border-slate-200 bg-slate-50 text-slate-700",
  }[tone];
  return (
    <div className={cn("flex items-center gap-2 rounded-lg border px-3 py-2", cls)}>
      <span className="opacity-70">{icon}</span>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wide opacity-70">{label}</div>
        <div className="text-base font-bold tabular-nums leading-tight">{value}</div>
      </div>
    </div>
  );
}

