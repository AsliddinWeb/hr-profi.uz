import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CheckCircle2, ChevronLeft, ChevronRight, RotateCcw, Save } from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import type { ScheduleStatus, ShiftSchedule, ShiftTemplate } from "@/lib/types";

interface Props {
  employeeId: string;
  defaultTemplateId: string | null;
  templates: ShiftTemplate[];
}

const REST = "REST" as const;

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function monthLabel(year: number, month: number, locale: string): string {
  return new Date(year, month - 1, 1).toLocaleString(locale, {
    month: "long",
    year: "numeric",
  });
}

/** Per-employee monthly grid: each cell is either a shift template id, the
 * REST sentinel, or empty. Saving sends a single bulk upsert; the row is
 * tagged with REST_DAY when REST is picked, so the Shifts/salary engine treats
 * it as a planned day off (no-show = no penalty, work = full overtime). */
export function MonthlyScheduleEditor({
  employeeId,
  defaultTemplateId,
  templates,
}: Props) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saveFlash, setSaveFlash] = useState(false);

  const fromIso = `${year}-${String(month).padStart(2, "0")}-01`;
  const days = daysInMonth(year, month);
  const toIso = `${year}-${String(month).padStart(2, "0")}-${String(days).padStart(2, "0")}`;

  const scheduleQ = useQuery({
    queryKey: ["shifts", "schedule", employeeId, fromIso, toIso],
    queryFn: async () =>
      (
        await api.get<ShiftSchedule[]>("/shifts/schedule", {
          params: { from: fromIso, to: toIso, employee_id: employeeId },
        })
      ).data,
    // Guard against the brief window where the parent passes employeeId="" /
    // undefined while routing.
    enabled: !!employeeId,
    // Schedule rows are tiny + the user can edit them right next to the live
    // earnings widget — never serve a stale cache here. Always pull fresh on
    // mount or after invalidation, otherwise saved REST_DAY rows can appear to
    // "disappear" until the cache eventually rolls over.
    staleTime: 0,
    refetchOnMount: "always",
  });

  const serverIndex = useMemo(() => {
    const map: Record<string, ShiftSchedule> = {};
    for (const s of scheduleQ.data ?? []) {
      map[s.date] = s;
    }
    return map;
  }, [scheduleQ.data]);

  const cellValue = (day: number): string => {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (edits[dateStr] !== undefined) return edits[dateStr];
    const srv = serverIndex[dateStr];
    if (!srv) return defaultTemplateId ?? "";
    if (srv.status === "REST_DAY") return REST;
    return srv.shift_template_id ?? "";
  };

  const setCell = (day: number, val: string) => {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    setEdits((p) => ({ ...p, [dateStr]: val }));
  };

  const dirtyCount = Object.keys(edits).length;

  const saveMut = useMutation({
    mutationFn: async () => {
      const entries = Object.entries(edits)
        .filter(([, v]) => v !== "")
        .map(([dateStr, v]) => {
          if (v === REST) {
            return {
              employee_id: employeeId,
              date: dateStr,
              shift_template_id: null,
              status: "REST_DAY" as ScheduleStatus,
            };
          }
          return {
            employee_id: employeeId,
            date: dateStr,
            shift_template_id: v,
            status: "PLANNED" as ScheduleStatus,
          };
        });
      if (entries.length === 0) return { created: 0, updated: 0 };
      return (
        await api.post<{ created: number; updated: number }>("/shifts/schedule", {
          entries,
        })
      ).data;
    },
    onSuccess: async () => {
      // Await the refetch before clearing edits so the cells transition
      // straight from "edited" to "server-confirmed" without a blank flash —
      // and the saved REST_DAY rows never appear to "disappear".
      await qc.invalidateQueries({ queryKey: ["shifts", "schedule"] });
      await qc.refetchQueries({
        queryKey: ["shifts", "schedule", employeeId, fromIso, toIso],
      });
      setEdits({});
      setSaveFlash(true);
    },
  });

  // Hide the "Saved ✓" indicator after a couple of seconds.
  useEffect(() => {
    if (!saveFlash) return;
    const id = setTimeout(() => setSaveFlash(false), 2500);
    return () => clearTimeout(id);
  }, [saveFlash]);

  const stepMonth = (delta: number) => {
    let y = year;
    let m = month + delta;
    if (m < 1) {
      y -= 1;
      m = 12;
    } else if (m > 12) {
      y += 1;
      m = 1;
    }
    setYear(y);
    setMonth(m);
    setEdits({});
  };

  // Quick action: fill all weekdays with default template, weekends as REST.
  const applyDefaultPattern = () => {
    if (!defaultTemplateId) return;
    const next = { ...edits };
    for (let d = 1; d <= days; d++) {
      const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const dow = new Date(year, month - 1, d).getDay();
      const isWeekend = dow === 0 || dow === 6;
      next[dateStr] = isWeekend ? REST : defaultTemplateId;
    }
    setEdits(next);
  };

  const stats = useMemo(() => {
    let work = 0;
    let rest = 0;
    let none = 0;
    for (let d = 1; d <= days; d++) {
      const v = cellValue(d);
      if (v === "") none += 1;
      else if (v === REST) rest += 1;
      else work += 1;
    }
    return { work, rest, none };
  }, [days, edits, serverIndex, defaultTemplateId, year, month]); // eslint-disable-line react-hooks/exhaustive-deps

  const dayHeader = (d: number) => {
    const dt = new Date(year, month - 1, d);
    const dow = dt.getDay();
    const dayName = dt.toLocaleDateString(i18n.language, { weekday: "short" });
    const isWeekend = dow === 0 || dow === 6;
    return { dayName, isWeekend };
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            iconOnly
            onClick={() => stepMonth(-1)}
            aria-label={t("common.back")}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-[140px] text-center text-sm font-semibold capitalize text-slate-700">
            {monthLabel(year, month, i18n.language)}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            iconOnly
            onClick={() => stepMonth(1)}
            aria-label={t("common.expand")}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500">
            <span className="font-semibold text-emerald-700">{stats.work}</span>{" "}
            {t("employees.schedule_stat_work")} ·{" "}
            <span className="font-semibold text-slate-600">{stats.rest}</span>{" "}
            {t("employees.schedule_stat_rest")} ·{" "}
            <span className="font-semibold text-slate-400">{stats.none}</span>{" "}
            {t("employees.schedule_stat_none")}
          </span>
          {defaultTemplateId && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={applyDefaultPattern}
            >
              <RotateCcw className="size-3.5" />
              {t("employees.schedule_apply_default")}
            </Button>
          )}
          {saveFlash && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
              <CheckCircle2 className="size-3.5" />
              {t("employees.schedule_saved")}
            </span>
          )}
          <Button
            type="button"
            size="sm"
            disabled={dirtyCount === 0 || saveMut.isPending}
            loading={saveMut.isPending}
            onClick={() => saveMut.mutate()}
          >
            <Save className="size-3.5" />
            {t("shifts_page.save")}
            {dirtyCount > 0 && ` (${dirtyCount})`}
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto p-3">
        <div className="grid grid-cols-7 gap-1.5 text-xs">
          {Array.from({ length: days }, (_, i) => i + 1).map((d) => {
            const { dayName, isWeekend } = dayHeader(d);
            const value = cellValue(d);
            const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
            const dirty = edits[dateStr] !== undefined;
            const isRest = value === REST;
            const isToday =
              d === today.getDate() &&
              month === today.getMonth() + 1 &&
              year === today.getFullYear();
            return (
              <div
                key={d}
                className={cn(
                  "flex min-h-[64px] flex-col rounded-md border bg-white p-1.5",
                  isWeekend && !isRest && "bg-slate-50",
                  isRest && "border-amber-200 bg-amber-50",
                  value !== "" && !isRest && "border-emerald-200",
                  dirty && "ring-2 ring-brand-300",
                  isToday && "outline outline-2 outline-offset-1 outline-brand-500"
                )}
              >
                <div className="mb-1 flex items-center justify-between text-[10px]">
                  <span className="font-semibold tabular-nums text-slate-700">{d}</span>
                  <span className={cn("text-slate-400", isWeekend && "text-slate-500")}>
                    {dayName}
                  </span>
                </div>
                <select
                  value={value}
                  onChange={(e) => setCell(d, e.target.value)}
                  className={cn(
                    "w-full rounded border-slate-200 bg-transparent px-1 py-0.5 text-[11px] focus:ring-1 focus:ring-brand-500",
                    isRest && "font-semibold text-amber-700",
                    value === "" && "text-slate-300"
                  )}
                >
                  <option value="">— {t("employees.schedule_none")} —</option>
                  <option value={REST}>{t("shifts_page.rest_day_short")}</option>
                  {templates.map((tp) => (
                    <option key={tp.id} value={tp.id}>
                      {tp.name.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      </div>

      {scheduleQ.isError && (
        <p className="px-4 pb-3 text-xs text-red-600">{apiErrorMessage(scheduleQ.error)}</p>
      )}
      {saveMut.isError && (
        <p className="px-4 pb-3 text-xs text-red-600">{apiErrorMessage(saveMut.error)}</p>
      )}
    </div>
  );
}
