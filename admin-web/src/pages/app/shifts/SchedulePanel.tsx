import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eraser,
  MoreVertical,
  RotateCcw,
  Save,
  Search,
  Wand2,
} from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/cn";
import type {
  Branch,
  Department,
  Employee,
  Page,
  ScheduleStatus,
  ShiftSchedule,
  ShiftTemplate,
} from "@/lib/types";

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

/** Stable hash → 1 of N pastel hues. Used to pick a colour per template id so
 * the grid is scannable at a glance without the admin having to memorise the
 * legend. */
function templateHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 31 + id.charCodeAt(i)) % 360;
  }
  return h;
}

function dateStrFor(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function SchedulePanel() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const today = new Date();

  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saveFlash, setSaveFlash] = useState(false);
  const [query, setQuery] = useState("");
  const [branchFilter, setBranchFilter] = useState<string>("all");
  const [deptFilter, setDeptFilter] = useState<string>("all");

  const fromIso = useMemo(() => `${year}-${String(month).padStart(2, "0")}-01`, [year, month]);
  const days = daysInMonth(year, month);
  const toIso = useMemo(
    () => `${year}-${String(month).padStart(2, "0")}-${String(days).padStart(2, "0")}`,
    [year, month, days]
  );

  // ---- Queries ----------------------------------------------------------
  const templatesQ = useQuery({
    queryKey: ["shifts", "templates"],
    queryFn: async () =>
      (await api.get<Page<ShiftTemplate>>("/shifts/templates")).data,
  });
  const employeesQ = useQuery({
    queryKey: ["employees", "for-shifts"],
    queryFn: async () =>
      (
        await api.get<Page<Employee>>("/employees", {
          params: { size: 200, is_active: true },
        })
      ).data,
  });
  const branchesQ = useQuery({
    queryKey: ["branches", "for-shifts"],
    queryFn: async () =>
      (await api.get<Page<Branch>>("/branches", { params: { size: 200 } })).data,
  });
  const deptsQ = useQuery({
    queryKey: ["departments", "for-shifts"],
    queryFn: async () =>
      (await api.get<Page<Department>>("/departments", { params: { size: 200 } })).data,
  });
  const scheduleQ = useQuery({
    queryKey: ["shifts", "schedule", fromIso, toIso],
    queryFn: async () =>
      (
        await api.get<ShiftSchedule[]>("/shifts/schedule", {
          params: { from: fromIso, to: toIso },
        })
      ).data,
    staleTime: 0,
    refetchOnMount: "always",
  });

  const templates = templatesQ.data?.items ?? [];
  const allEmployees = employeesQ.data?.items ?? [];
  const branches = branchesQ.data?.items ?? [];
  const allDepts = deptsQ.data?.items ?? [];

  const deptOptions = useMemo(
    () =>
      branchFilter === "all"
        ? allDepts
        : allDepts.filter((d) => d.branch_id === branchFilter),
    [allDepts, branchFilter]
  );

  // Reset dept filter when branch changes and current dept doesn't fit.
  useEffect(() => {
    if (
      deptFilter !== "all" &&
      branchFilter !== "all" &&
      !deptOptions.find((d) => d.id === deptFilter)
    ) {
      setDeptFilter("all");
    }
  }, [deptFilter, branchFilter, deptOptions]);

  const employees = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allEmployees.filter((e) => {
      if (branchFilter !== "all" && e.branch_id !== branchFilter) return false;
      if (deptFilter !== "all" && e.department_id !== deptFilter) return false;
      if (
        q &&
        !e.full_name.toLowerCase().includes(q) &&
        !(e.employee_code ?? "").toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [allEmployees, query, branchFilter, deptFilter]);

  // ---- Server index ----------------------------------------------------
  const serverIndex = useMemo(() => {
    const map: Record<string, ShiftSchedule> = {};
    for (const s of scheduleQ.data ?? []) {
      map[`${s.employee_id}|${s.date}`] = s;
    }
    return map;
  }, [scheduleQ.data]);

  const cellValue = (empId: string, day: number): string => {
    const dateStr = dateStrFor(year, month, day);
    const key = `${empId}|${dateStr}`;
    if (edits[key] !== undefined) return edits[key];
    const srv = serverIndex[key];
    if (!srv) return "";
    if (srv.status === "REST_DAY") return REST;
    return srv.shift_template_id ?? "";
  };

  const setCell = (empId: string, day: number, value: string) => {
    const dateStr = dateStrFor(year, month, day);
    setEdits((p) => ({ ...p, [`${empId}|${dateStr}`]: value }));
  };

  const dirtyCount = Object.keys(edits).length;

  // ---- Mutation -------------------------------------------------------
  const saveScheduleMut = useMutation({
    mutationFn: async () => {
      // Empty-string cells = "user explicitly cleared this day". We
      // persist them as CANCELLED so the auto-regen step (which only
      // rewrites PLANNED/REST_DAY) leaves them alone — otherwise the
      // schedule would silently come back on the next template PATCH.
      const entries = Object.entries(edits).map(([key, value]) => {
        const [employee_id, date] = key.split("|");
        if (value === "") {
          return {
            employee_id,
            date,
            shift_template_id: null,
            status: "CANCELLED" as ScheduleStatus,
          };
        }
        if (value === REST) {
          return {
            employee_id,
            date,
            shift_template_id: null,
            status: "REST_DAY" as ScheduleStatus,
          };
        }
        return {
          employee_id,
          date,
          shift_template_id: value,
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
      await qc.invalidateQueries({ queryKey: ["shifts", "schedule"] });
      await qc.refetchQueries({ queryKey: ["shifts", "schedule", fromIso, toIso] });
      setEdits({});
      setSaveFlash(true);
    },
  });

  useEffect(() => {
    if (!saveFlash) return;
    const id = setTimeout(() => setSaveFlash(false), 2500);
    return () => clearTimeout(id);
  }, [saveFlash]);

  // ---- Bulk actions ---------------------------------------------------
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

  /** Apply the employee's default shift template across the visible month —
   * filling working days from the template's ``working_days`` (ISO 1..7)
   * with the template, and the rest with REST_DAY.
   *
   * Skips days the user already touched in this edit session so we don't
   * stomp on in-flight tweaks. Falls back to Mon-Fri working / Sat-Sun
   * rest if the template wasn't loaded for some reason.
   */
  const applyDefaultRow = (empId: string) => {
    const tplId = employees.find((e) => e.id === empId)?.shift_template_id;
    if (!tplId) {
      window.alert(t("shifts_page.row_default_missing") || "No default template set on employee");
      return;
    }
    const tpl = templates.find((tp) => tp.id === tplId);
    const workingSet = new Set(
      tpl?.working_days && tpl.working_days.length
        ? tpl.working_days
        : [1, 2, 3, 4, 5]
    );
    const next = { ...edits };
    for (let d = 1; d <= days; d++) {
      const dateStr = dateStrFor(year, month, d);
      const key = `${empId}|${dateStr}`;
      if (next[key] !== undefined) continue;
      // ``getDay()`` returns 0..6 with Sunday = 0; convert to ISO 1..7
      // (Monday=1 … Sunday=7) to match the template's working_days.
      const dow = new Date(year, month - 1, d).getDay();
      const iso = dow === 0 ? 7 : dow;
      next[key] = workingSet.has(iso) ? tplId : REST;
    }
    setEdits(next);
  };

  const clearRow = async (empId: string) => {
    // Persist directly. Going through saveScheduleMut would lose state
    // race-y'ness — the mutation fn closes over ``edits``, and the new
    // empty values aren't visible to it on the same tick. We just send
    // the cancelled entries straight to the API.
    const dates: string[] = [];
    for (let d = 1; d <= days; d++) dates.push(dateStrFor(year, month, d));

    setEdits((prev) => {
      const next = { ...prev };
      for (const date of dates) next[`${empId}|${date}`] = "";
      return next;
    });

    try {
      await api.post("/shifts/schedule", {
        entries: dates.map((date) => ({
          employee_id: empId,
          date,
          shift_template_id: null,
          status: "CANCELLED" as ScheduleStatus,
        })),
      });
      await qc.invalidateQueries({ queryKey: ["shifts", "schedule"] });
      await qc.refetchQueries({ queryKey: ["shifts", "schedule", fromIso, toIso] });
      // Clear local edits for this employee since server now agrees.
      setEdits((prev) => {
        const next = { ...prev };
        for (const date of dates) delete next[`${empId}|${date}`];
        return next;
      });
      setSaveFlash(true);
    } catch (err) {
      window.alert(apiErrorMessage(err));
    }
  };

  /** Fill an entire DAY column for visible employees. Used for company-wide
   * holidays / bridge days etc. */
  const fillColumn = (day: number, value: string) => {
    const next = { ...edits };
    for (const e of employees) {
      const dateStr = dateStrFor(year, month, day);
      next[`${e.id}|${dateStr}`] = value;
    }
    setEdits(next);
  };

  // ---- Stats ----------------------------------------------------------
  const visibleStats = useMemo(() => {
    let work = 0;
    let rest = 0;
    let none = 0;
    for (const e of employees) {
      for (let d = 1; d <= days; d++) {
        const v = cellValue(e.id, d);
        if (v === "") none += 1;
        else if (v === REST) rest += 1;
        else work += 1;
      }
    }
    const total = employees.length * days;
    const coverage = total === 0 ? 0 : Math.round(((work + rest) / total) * 100);
    return { work, rest, none, total, coverage };
  }, [employees, days, edits, serverIndex, year, month]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-5">
      {/* Top toolbar */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
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
          <span className="min-w-[160px] text-center text-sm font-semibold capitalize text-slate-700">
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

        <div className="min-w-[200px] flex-1">
          <Input
            label={t("shifts_page.search_employee")}
            placeholder={t("shifts_page.search_employee_placeholder") ?? ""}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            prefix={<Search className="size-4" />}
          />
        </div>
        <div>
          <label className="label">{t("employees.branch")}</label>
          <select
            className="input min-w-[140px]"
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
          >
            <option value="all">{t("departments_page.branch_all")}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{t("employees.department")}</label>
          <select
            className="input min-w-[140px]"
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
          >
            <option value="all">{t("departments_page.branch_all")}</option>
            {deptOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {saveFlash && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
              <CheckCircle2 className="size-3.5" />
              {t("employees.schedule_saved")}
            </span>
          )}
          <Button
            type="button"
            variant="success"
            disabled={dirtyCount === 0 || saveScheduleMut.isPending}
            loading={saveScheduleMut.isPending}
            onClick={() => saveScheduleMut.mutate()}
          >
            <Save className="size-4" />
            {t("shifts_page.save")}
            {dirtyCount > 0 && ` (${dirtyCount})`}
          </Button>
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          tone="emerald"
          label={t("shifts_page.stat_work_cells")}
          value={visibleStats.work}
        />
        <StatTile
          tone="amber"
          label={t("shifts_page.stat_rest_cells")}
          value={visibleStats.rest}
        />
        <StatTile
          tone="slate"
          label={t("shifts_page.stat_empty_cells")}
          value={visibleStats.none}
        />
        <StatTile
          tone="brand"
          label={t("shifts_page.stat_coverage")}
          value={`${visibleStats.coverage}%`}
        />
      </div>

      {/* Template legend (only when templates exist) */}
      {templates.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-500">{t("shifts_page.legend")}:</span>
          {templates.map((tp) => (
            <span
              key={tp.id}
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5"
              style={{
                background: `hsl(${templateHue(tp.id)} 80% 95%)`,
                color: `hsl(${templateHue(tp.id)} 60% 30%)`,
              }}
            >
              <span
                className="size-1.5 rounded-full"
                style={{ background: `hsl(${templateHue(tp.id)} 60% 50%)` }}
              />
              {tp.name}
              {tp.start_time && tp.end_time && (
                <span className="opacity-70">
                  {tp.start_time.slice(0, 5)}–{tp.end_time.slice(0, 5)}
                </span>
              )}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-0.5 text-amber-800">
            <span className="size-1.5 rounded-full bg-amber-500" />
            {t("shifts_page.rest_day_short")}
          </span>
        </div>
      )}

      {/* Grid */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50">
            <tr>
              <th className="sticky left-0 z-20 min-w-[220px] bg-slate-50 px-3 py-2 font-medium">
                {t("shifts_page.employee")}
              </th>
              {Array.from({ length: days }, (_, i) => i + 1).map((d) => {
                const dt = new Date(year, month - 1, d);
                const dow = dt.getDay();
                const isWeekend = dow === 0 || dow === 6;
                const isToday =
                  d === today.getDate() &&
                  month === today.getMonth() + 1 &&
                  year === today.getFullYear();
                return (
                  <th
                    key={d}
                    className={cn(
                      "px-1 py-1.5 text-center font-medium",
                      isWeekend && "bg-slate-100 text-slate-400",
                      isToday && "bg-brand-50 text-brand-700"
                    )}
                  >
                    <ColumnHeader
                      day={d}
                      year={year}
                      month={month}
                      templates={templates}
                      onFill={(value) => fillColumn(d, value)}
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {employeesQ.isLoading ? (
              <tr>
                <td colSpan={days + 1} className="px-3 py-6 text-center text-sm text-slate-500">
                  {t("common.loading")}
                </td>
              </tr>
            ) : employees.length === 0 ? (
              <tr>
                <td colSpan={days + 1} className="px-3 py-6 text-center text-sm text-slate-500">
                  {t("common.no_data")}
                </td>
              </tr>
            ) : (
              employees.map((e) => (
                <EmployeeRow
                  key={e.id}
                  employee={e}
                  year={year}
                  month={month}
                  days={days}
                  templates={templates}
                  cellValue={(d) => cellValue(e.id, d)}
                  setCell={(d, v) => setCell(e.id, d, v)}
                  edits={edits}
                  onApplyDefault={() => applyDefaultRow(e.id)}
                  onClear={() => clearRow(e.id)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {saveScheduleMut.isError && (
        <p className="text-sm text-red-600">{apiErrorMessage(saveScheduleMut.error)}</p>
      )}
    </div>
  );
}

// ---------------- Employee row -----------------------------------------

function EmployeeRow({
  employee,
  year,
  month,
  days,
  templates,
  cellValue,
  setCell,
  edits,
  onApplyDefault,
  onClear,
}: {
  employee: Employee;
  year: number;
  month: number;
  days: number;
  templates: ShiftTemplate[];
  cellValue: (day: number) => string;
  setCell: (day: number, value: string) => void;
  edits: Record<string, string>;
  onApplyDefault: () => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const today = new Date();

  return (
    <tr className="border-t border-slate-100 hover:bg-slate-50/50">
      <td className="sticky left-0 z-10 min-w-[220px] bg-white px-3 py-1.5 align-middle">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Avatar photo={employee.photo_url} name={employee.full_name} />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-slate-800">
                {employee.full_name}
              </div>
              <div className="text-[10px] text-slate-400">{employee.employee_code}</div>
            </div>
          </div>
          <RowMenu
            onApplyDefault={onApplyDefault}
            onClear={onClear}
          />
        </div>
      </td>
      {Array.from({ length: days }, (_, i) => i + 1).map((d) => {
        const value = cellValue(d);
        const dateStr = dateStrFor(year, month, d);
        const key = `${employee.id}|${dateStr}`;
        const dirty = edits[key] !== undefined;
        const isRest = value === REST;
        const isToday =
          d === today.getDate() &&
          month === today.getMonth() + 1 &&
          year === today.getFullYear();
        const dow = new Date(year, month - 1, d).getDay();
        const isWeekend = dow === 0 || dow === 6;
        const tpl = !isRest ? templates.find((t) => t.id === value) : null;
        const hue = tpl ? templateHue(tpl.id) : null;

        return (
          <td
            key={d}
            className={cn(
              "p-0",
              isWeekend && !value && "bg-slate-50",
              isRest && "bg-amber-50",
              dirty && "ring-2 ring-inset ring-brand-300",
              isToday && "outline outline-1 outline-brand-400"
            )}
            style={hue !== null ? { background: `hsl(${hue} 80% 96%)` } : undefined}
            title={
              isRest
                ? t("shifts_page.rest_day_hint")
                : tpl
                ? `${tpl.name} · ${tpl.start_time?.slice(0, 5) ?? "—"}–${tpl.end_time?.slice(0, 5) ?? "—"}`
                : undefined
            }
          >
            <select
              value={value}
              onChange={(ev) => setCell(d, ev.target.value)}
              className={cn(
                "h-8 w-full cursor-pointer border-0 bg-transparent px-1 text-center text-[11px] focus:ring-1 focus:ring-brand-500",
                value === "" && "text-slate-300",
                isRest && "font-semibold text-amber-700"
              )}
              style={hue !== null ? { color: `hsl(${hue} 60% 30%)`, fontWeight: 600 } : undefined}
            >
              <option value="">—</option>
              <option value={REST}>{t("shifts_page.rest_day_short")}</option>
              {templates.map((tp) => (
                <option key={tp.id} value={tp.id}>
                  {tp.name.slice(0, 8)}
                </option>
              ))}
            </select>
          </td>
        );
      })}
    </tr>
  );
}

// ---------------- Portal dropdown (escapes overflow:auto) ----------------
//
// The schedule grid wraps the table in `overflow-x-auto`, which clips any
// `position:absolute` element that overflows the wrapper. The earlier impl
// (absolute + z-30) silently disappeared whenever the menu sat near the edge.
// We render the menu in document.body via createPortal and pin it with
// `position:fixed` to the trigger button's bounding rect — safe regardless
// of how deep the trigger lives.

interface PortalMenuProps {
  open: boolean;
  anchor: HTMLElement | null;
  onClose: () => void;
  /** "left" anchors the menu's left edge to the trigger; "right" anchors the
   * right edges. */
  align?: "left" | "right";
  /** Width in px (default 208 = w-52). */
  width?: number;
  children: React.ReactNode;
}

function PortalMenu({
  open,
  anchor,
  onClose,
  align = "right",
  width = 208,
  children,
}: PortalMenuProps) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor) {
      setPos(null);
      return;
    }
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const left =
        align === "right"
          ? Math.max(8, Math.min(window.innerWidth - width - 8, r.right - width))
          : Math.max(8, Math.min(window.innerWidth - width - 8, r.left));
      setPos({ top: r.bottom + 4, left });
    };
    place();
    // Reposition while the user scrolls/resizes — closing on scroll feels too
    // aggressive when the menu is opened from a sticky cell.
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchor, align, width]);

  // Outside click + Escape close. We bind on document, but skip events that
  // originated inside the trigger or the menu itself.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (anchor && anchor.contains(target)) return;
      const menu = document.getElementById("__shift_portal_menu__");
      if (menu && menu.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, anchor, onClose]);

  if (!open || !pos || typeof document === "undefined") return null;
  return createPortal(
    <div
      id="__shift_portal_menu__"
      role="menu"
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        width,
        zIndex: 60,
      }}
      className="rounded-md border border-slate-200 bg-white p-1 text-left shadow-lg"
    >
      {children}
    </div>,
    document.body
  );
}

// ---------------- Column header (with bulk-fill popover) ----------------

function ColumnHeader({
  day,
  year,
  month,
  templates,
  onFill,
}: {
  day: number;
  year: number;
  month: number;
  templates: ShiftTemplate[];
  onFill: (value: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  const dt = new Date(year, month - 1, day);
  const dow = dt.toLocaleDateString(undefined, { weekday: "short" });

  return (
    <div className="flex flex-col items-center gap-0.5">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded px-1 py-0.5 text-[11px] font-semibold leading-none hover:bg-slate-200/60"
        title={t("shifts_page.bulk_fill_column") ?? undefined}
      >
        {day}
      </button>
      <span className="text-[9px] uppercase leading-none text-slate-400">{dow}</span>

      <PortalMenu
        open={open}
        anchor={btnRef.current}
        onClose={() => setOpen(false)}
        align="left"
        width={176}
      >
        <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-slate-400">
          {t("shifts_page.bulk_fill_column")}
        </div>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-amber-50"
          onClick={() => {
            onFill(REST);
            setOpen(false);
          }}
        >
          <span className="size-2 rounded-full bg-amber-500" />
          {t("shifts_page.rest_day")}
        </button>
        {templates.map((tp) => (
          <button
            key={tp.id}
            type="button"
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-slate-50"
            onClick={() => {
              onFill(tp.id);
              setOpen(false);
            }}
          >
            <span
              className="size-2 rounded-full"
              style={{ background: `hsl(${templateHue(tp.id)} 60% 50%)` }}
            />
            {tp.name}
          </button>
        ))}
        <div className="my-0.5 border-t border-slate-100" />
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-50"
          onClick={() => {
            onFill("");
            setOpen(false);
          }}
        >
          <Eraser className="size-3" />
          {t("shifts_page.bulk_clear")}
        </button>
      </PortalMenu>
    </div>
  );
}

// ---------------- Row menu ----------------------------------------------

function RowMenu({
  onApplyDefault,
  onClear,
}: {
  onApplyDefault: () => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        aria-label="Menu"
      >
        <MoreVertical className="size-4" />
      </button>
      <PortalMenu
        open={open}
        anchor={btnRef.current}
        onClose={() => setOpen(false)}
        align="right"
        width={208}
      >
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-slate-50"
          onClick={() => {
            onApplyDefault();
            setOpen(false);
          }}
        >
          <Wand2 className="size-3.5 text-brand-600" />
          {t("shifts_page.row_apply_default")}
        </button>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-slate-50"
          onClick={() => {
            if (
              window.confirm(
                t("shifts_page.row_clear_confirm") ||
                  "Clear this employee's schedule for the visible month?"
              )
            ) {
              onClear();
              setOpen(false);
            }
          }}
        >
          <Eraser className="size-3.5 text-slate-500" />
          {t("shifts_page.row_clear")}
        </button>
        <div className="my-0.5 border-t border-slate-100" />
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-slate-50"
          onClick={() => {
            onApplyDefault();
            setOpen(false);
          }}
        >
          <RotateCcw className="size-3.5 text-slate-500" />
          {t("shifts_page.row_reset_to_default")}
        </button>
      </PortalMenu>
    </>
  );
}

// ---------------- Avatar / Stats helpers --------------------------------

function Avatar({ photo, name }: { photo: string | null; name: string }) {
  if (photo) {
    return (
      <img
        src={photo}
        alt=""
        className="size-7 shrink-0 rounded-full object-cover ring-1 ring-slate-200"
      />
    );
  }
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[10px] font-semibold text-brand-700">
      {initials || "•"}
    </span>
  );
}

function StatTile({
  tone,
  label,
  value,
}: {
  tone: "emerald" | "amber" | "slate" | "brand";
  label: string;
  value: number | string;
}) {
  const cls = {
    emerald: "border-emerald-200 bg-emerald-50",
    amber: "border-amber-200 bg-amber-50",
    slate: "border-slate-200 bg-slate-50",
    brand: "border-brand-200 bg-brand-50",
  }[tone];
  const text = {
    emerald: "text-emerald-800",
    amber: "text-amber-800",
    slate: "text-slate-700",
    brand: "text-brand-800",
  }[tone];
  return (
    <div className={cn("rounded-lg border px-4 py-3", cls)}>
      <div className={cn("text-[10px] uppercase tracking-wide opacity-70", text)}>{label}</div>
      <div className={cn("mt-0.5 text-xl font-bold tabular-nums", text)}>{value}</div>
    </div>
  );
}
