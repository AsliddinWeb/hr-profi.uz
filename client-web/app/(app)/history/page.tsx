"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Calendar,
  Clock,
  History as HistoryIcon,
  ListChecks,
  LogIn,
  LogOut,
  MapPin,
} from "lucide-react";

import { api } from "@/lib/api";
import { fmtShortDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { AttendanceRecord, CheckType } from "@/lib/types";

type Filter = "all" | CheckType;

function fmtTime(iso: string, locale: string): string {
  return new Date(iso).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function HistoryPage() {
  const { t, i18n } = useTranslation();
  const [filter, setFilter] = useState<Filter>("all");

  const historyQ = useQuery({
    queryKey: ["attendance", "history", "month"],
    queryFn: async () => {
      const today = new Date();
      const from = new Date(today);
      from.setDate(from.getDate() - 30);
      return (
        await api.get<AttendanceRecord[]>("/attendance/history", {
          params: {
            from: from.toISOString().slice(0, 10),
            to: today.toISOString().slice(0, 10),
            limit: 200,
          },
        })
      ).data;
    },
    refetchInterval: 5 * 60_000,
  });

  const records = historyQ.data ?? [];
  const filtered = filter === "all" ? records : records.filter((r) => r.check_type === filter);

  const stats = useMemo(() => {
    let lateCount = 0;
    let otTotal = 0;
    for (const r of records) {
      if (r.is_late) lateCount += 1;
      otTotal += r.overtime_minutes;
    }
    return { records: records.length, lateCount, otTotal };
  }, [records]);

  // Group by date for the timeline rendering.
  const grouped = useMemo(() => {
    const out: { date: string; rows: AttendanceRecord[] }[] = [];
    for (const r of filtered) {
      const day = r.timestamp.slice(0, 10);
      const last = out[out.length - 1];
      if (last && last.date === day) last.rows.push(r);
      else out.push({ date: day, rows: [r] });
    }
    return out;
  }, [filtered]);

  return (
    <div className="space-y-4">
      <header className="pt-2">
        <h1 className="text-xl font-bold text-slate-900">
          {t("history.title")}
        </h1>
        <p className="mt-0.5 text-xs text-slate-500">{t("history.subtitle")}</p>
      </header>

      {/* Mini stats */}
      <div className="grid grid-cols-3 gap-2">
        <Stat
          tone="brand"
          icon={<HistoryIcon className="size-3.5" />}
          label={t("history.stat_records")}
          value={stats.records}
        />
        <Stat
          tone="amber"
          icon={<AlertTriangle className="size-3.5" />}
          label={t("history.stat_late_count")}
          value={stats.lateCount}
        />
        <Stat
          tone="emerald"
          icon={<Clock className="size-3.5" />}
          label={t("history.stat_overtime_minutes")}
          value={`${Math.floor(stats.otTotal / 60)}h ${stats.otTotal % 60}m`}
        />
      </div>

      {/* Filter chips */}
      <div className="flex gap-2">
        <Chip
          active={filter === "all"}
          onClick={() => setFilter("all")}
          label={t("history.filter_all")}
          icon={<ListChecks className="size-3" />}
        />
        <Chip
          active={filter === "CHECK_IN"}
          onClick={() => setFilter("CHECK_IN")}
          label={t("history.filter_in")}
          icon={<LogIn className="size-3" />}
        />
        <Chip
          active={filter === "CHECK_OUT"}
          onClick={() => setFilter("CHECK_OUT")}
          label={t("history.filter_out")}
          icon={<LogOut className="size-3" />}
        />
      </div>

      {/* Timeline */}
      {historyQ.isLoading ? (
        <p className="py-8 text-center text-sm text-slate-500">
          {t("common.loading")}
        </p>
      ) : grouped.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 p-10 text-center">
          <HistoryIcon className="size-8 text-slate-300" />
          <p className="text-sm font-medium text-slate-600">
            {t("history.no_records")}
          </p>
        </div>
      ) : (
        <ul className="space-y-4">
          {grouped.map((g) => (
            <li key={g.date}>
              <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <Calendar className="size-3.5" />
                {fmtShortDate(g.date, i18n.language)}
                <span className="ml-auto rounded-full bg-slate-100 px-1.5 text-[10px] tabular-nums text-slate-600">
                  {g.rows.length}
                </span>
              </div>
              <ol className="space-y-1.5">
                {g.rows
                  .slice()
                  .reverse()
                  .map((r) => {
                    const isIn = r.check_type === "CHECK_IN";
                    return (
                      <li
                        key={r.id}
                        className="card flex items-start gap-3 p-2.5"
                      >
                        <span
                          className={cn(
                            "flex size-8 shrink-0 items-center justify-center rounded-full text-white",
                            isIn ? "bg-emerald-500" : "bg-slate-500"
                          )}
                        >
                          {isIn ? (
                            <LogIn className="size-3.5" />
                          ) : (
                            <LogOut className="size-3.5" />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2">
                            <span className="font-mono text-sm font-bold tabular-nums text-slate-800">
                              {fmtTime(r.timestamp, i18n.language)}
                            </span>
                            <span className="text-[10px] uppercase text-slate-400">
                              {r.method.replace("_", " ")}
                            </span>
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px]">
                            {r.is_late && (
                              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800">
                                +{r.late_minutes}m late
                              </span>
                            )}
                            {r.overtime_minutes > 0 && (
                              <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 font-semibold text-emerald-800">
                                +{r.overtime_minutes}m OT
                              </span>
                            )}
                            {r.status === "SUSPICIOUS" && (
                              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800">
                                ⚠
                              </span>
                            )}
                            {r.status === "REJECTED" && (
                              <span className="rounded-full bg-rose-100 px-1.5 py-0.5 font-semibold text-rose-800">
                                ✗
                              </span>
                            )}
                            {r.latitude != null && (
                              <span className="inline-flex items-center gap-0.5 text-slate-500">
                                <MapPin className="size-2.5" />
                                {Number(r.latitude).toFixed(3)},
                                {Number(r.longitude).toFixed(3)}
                              </span>
                            )}
                          </div>
                        </div>
                        {r.selfie_url && (
                          <a
                            href={r.selfie_url}
                            target="_blank"
                            rel="noreferrer"
                            className="block size-10 shrink-0 overflow-hidden rounded-lg ring-1 ring-slate-200"
                          >
                            <img
                              src={r.selfie_url}
                              alt=""
                              className="size-full object-cover"
                            />
                          </a>
                        )}
                      </li>
                    );
                  })}
              </ol>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Chip({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold transition",
        active
          ? "border-brand-600 bg-brand-600 text-white shadow-sm"
          : "border-slate-200 bg-white text-slate-700 hover:border-brand-300"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function Stat({
  tone,
  icon,
  label,
  value,
}: {
  tone: "brand" | "amber" | "emerald";
  icon: React.ReactNode;
  label: string;
  value: number | string;
}) {
  const cls = {
    brand: "border-brand-200 bg-brand-50 text-brand-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
  }[tone];
  return (
    <div className={cn("rounded-xl border px-2.5 py-2", cls)}>
      <div className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide opacity-70">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-0.5 text-base font-bold tabular-nums leading-tight">
        {value}
      </div>
    </div>
  );
}
