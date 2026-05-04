"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  CalendarRange,
  CalendarX,
  Clock,
  Coffee,
  Sparkles,
  Sunrise,
} from "lucide-react";

import { api } from "@/lib/api";
import { fmtTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { MyShiftRow, ScheduleStatus } from "@/lib/types";

const STATUS_TONE: Record<
  ScheduleStatus,
  { bg: string; text: string; ring: string; bar: string }
> = {
  PLANNED: {
    bg: "bg-brand-50",
    text: "text-brand-700",
    ring: "ring-brand-200",
    bar: "bg-brand-500",
  },
  SWAPPED: {
    bg: "bg-indigo-50",
    text: "text-indigo-700",
    ring: "ring-indigo-200",
    bar: "bg-indigo-500",
  },
  CANCELLED: {
    bg: "bg-slate-100",
    text: "text-slate-500",
    ring: "ring-slate-200",
    bar: "bg-slate-300",
  },
  ON_LEAVE: {
    bg: "bg-amber-50",
    text: "text-amber-700",
    ring: "ring-amber-200",
    bar: "bg-amber-500",
  },
  REST_DAY: {
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    ring: "ring-emerald-200",
    bar: "bg-emerald-500",
  },
};

function dayOffset(iso: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const that = new Date(iso);
  that.setHours(0, 0, 0, 0);
  return Math.round((that.getTime() - today.getTime()) / 86_400_000);
}

export default function ShiftsPage() {
  const { t, i18n } = useTranslation();

  const shiftsQ = useQuery({
    queryKey: ["shifts", "upcoming"],
    queryFn: async () =>
      (
        await api.get<MyShiftRow[]>("/shifts/me/upcoming", {
          params: { days: 14 },
        })
      ).data,
    refetchInterval: 5 * 60_000,
  });

  const items = shiftsQ.data ?? [];

  // Group by date so the rendering loop can render a header per day.
  const grouped = useMemo(() => {
    const out: { date: string; rows: MyShiftRow[] }[] = [];
    for (const r of items) {
      const last = out[out.length - 1];
      if (last && last.date === r.date) last.rows.push(r);
      else out.push({ date: r.date, rows: [r] });
    }
    return out;
  }, [items]);

  return (
    <div className="space-y-4">
      <header className="pt-2">
        <h1 className="text-xl font-bold text-slate-900">{t("shifts.title")}</h1>
        <p className="mt-0.5 text-xs text-slate-500">{t("shifts.subtitle")}</p>
      </header>

      {shiftsQ.isLoading ? (
        <p className="py-8 text-center text-sm text-slate-500">
          {t("common.loading")}
        </p>
      ) : grouped.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 p-10 text-center">
          <CalendarX className="size-8 text-slate-300" />
          <p className="text-sm font-medium text-slate-600">
            {t("shifts.no_shifts")}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {grouped.map((g) => {
            const offset = dayOffset(g.date);
            const dateLabel =
              offset === 0
                ? t("shifts.today_label")
                : offset === 1
                  ? t("shifts.tomorrow_label")
                  : new Date(g.date).toLocaleDateString(i18n.language, {
                      weekday: "long",
                      day: "2-digit",
                      month: "short",
                    });
            return (
              <li key={g.date}>
                <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <CalendarRange className="size-3.5" />
                  <span>{dateLabel}</span>
                  <span className="text-[10px] tabular-nums text-slate-400">
                    {new Date(g.date).toLocaleDateString(i18n.language, {
                      day: "2-digit",
                      month: "short",
                    })}
                  </span>
                </div>
                <ul className="space-y-2">
                  {g.rows.map((r) => {
                    const tone = STATUS_TONE[r.status];
                    const isLeaveOrRest =
                      r.status === "ON_LEAVE" || r.status === "REST_DAY";
                    return (
                      <li
                        key={r.id}
                        className="card flex items-stretch overflow-hidden"
                      >
                        <span
                          className={cn("w-1 shrink-0", tone.bar)}
                          aria-hidden
                        />
                        <div className="flex-1 p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                {isLeaveOrRest ? (
                                  r.status === "REST_DAY" ? (
                                    <Sparkles className="size-4 text-emerald-600" />
                                  ) : (
                                    <Coffee className="size-4 text-amber-600" />
                                  )
                                ) : (
                                  <Sunrise className="size-4 text-brand-600" />
                                )}
                                <span className="font-semibold text-slate-800">
                                  {r.template_name ||
                                    (isLeaveOrRest
                                      ? t(
                                          `shifts.status_${r.status.toLowerCase()}`
                                        )
                                      : t("shifts.no_template"))}
                                </span>
                              </div>
                              {!isLeaveOrRest && (r.start_time || r.end_time) && (
                                <div className="mt-1.5 flex items-center gap-1 font-mono text-base font-bold tabular-nums text-slate-900">
                                  <Clock className="size-3.5 text-slate-400" />
                                  {fmtTime(r.start_time)} — {fmtTime(r.end_time)}
                                </div>
                              )}
                              {r.expected_hours && (
                                <div className="mt-0.5 text-[11px] text-slate-500">
                                  {t("shifts.expected_hours")}:{" "}
                                  {Number(r.expected_hours).toFixed(1)}h
                                  {r.break_minutes != null &&
                                    r.break_minutes > 0 && (
                                      <span className="ml-2">
                                        · {t("shifts.break")}: {r.break_minutes}m
                                      </span>
                                    )}
                                </div>
                              )}
                            </div>
                            <span
                              className={cn(
                                "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ring-1",
                                tone.bg,
                                tone.text,
                                tone.ring
                              )}
                            >
                              {t(`shifts.status_${r.status.toLowerCase()}`)}
                            </span>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
