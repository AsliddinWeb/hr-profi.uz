import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Calendar,
  CalendarDays,
  Check,
  Clock,
  Coins,
  Edit2,
  Pencil,
  Search,
  Sparkles,
  X,
  XCircle,
} from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Dialog, DialogFooter } from "@/components/ui/Dialog";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/Table";
import { useEnumLabel } from "@/lib/enum";
import { cn } from "@/lib/cn";
import type {
  Employee,
  LeaveRequest,
  LeaveStatus,
  LeaveType,
  Page,
} from "@/lib/types";

function statusTone(s: LeaveStatus): "success" | "warning" | "danger" | "default" {
  if (s === "APPROVED") return "success";
  if (s === "PENDING") return "warning";
  if (s === "REJECTED") return "danger";
  return "default";
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function RequestsTab() {
  const { t, i18n } = useTranslation();
  const label = useEnumLabel();
  const qc = useQueryClient();
  const nav = useNavigate();

  const [statusFilter, setStatusFilter] = useState<"" | LeaveStatus>("");
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const empQ = useQuery({
    queryKey: ["employees", "for-leave-requests"],
    queryFn: async () =>
      (await api.get<Page<Employee>>("/employees", { params: { size: 200 } })).data,
  });
  const typesQ = useQuery({
    queryKey: ["leave-types"],
    queryFn: async () => (await api.get<LeaveType[]>("/leave-types")).data,
  });

  // Always fetch unfiltered — stats need the global counts and the table
  // filters locally. Saves a round-trip per status switch and lets the user
  // see the totals stay constant across tab clicks.
  const requestsQ = useQuery({
    queryKey: ["leave-requests"],
    queryFn: async () => (await api.get<LeaveRequest[]>("/leave-requests")).data,
    refetchInterval: 60_000,
  });

  const empById = useMemo(
    () => new Map(empQ.data?.items.map((e) => [e.id, e]) ?? []),
    [empQ.data]
  );
  const typeById = useMemo(
    () => new Map((typesQ.data ?? []).map((tp) => [tp.id, tp])),
    [typesQ.data]
  );

  // Sort state for table headers: PENDING-first by default, then newest.
  type SortKey = "newest" | "oldest" | "name" | "days_desc" | "days_asc" | "status";
  const [sortKey, setSortKey] = useState<SortKey>("newest");

  const filtered = useMemo(() => {
    const all = requestsQ.data ?? [];
    const q = query.trim().toLowerCase();
    const list = all.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (q) {
        const emp = empById.get(r.employee_id);
        if (
          !emp?.full_name.toLowerCase().includes(q) &&
          !(emp?.employee_code ?? "").toLowerCase().includes(q)
        )
          return false;
      }
      if (from && r.end_date < from) return false;
      if (to && r.start_date > to) return false;
      return true;
    });
    // Stable sort — same input → same order, so the table doesn't jitter.
    const statusRank: Record<string, number> = {
      PENDING: 0,
      APPROVED: 1,
      REJECTED: 2,
      CANCELLED: 3,
    };
    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sortKey) {
        case "oldest":
          return a.created_at.localeCompare(b.created_at);
        case "days_desc":
          return b.days - a.days || b.created_at.localeCompare(a.created_at);
        case "days_asc":
          return a.days - b.days || b.created_at.localeCompare(a.created_at);
        case "name": {
          const an = empById.get(a.employee_id)?.full_name ?? "";
          const bn = empById.get(b.employee_id)?.full_name ?? "";
          return an.localeCompare(bn);
        }
        case "status":
          return (
            (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9) ||
            b.created_at.localeCompare(a.created_at)
          );
        default:
          return b.created_at.localeCompare(a.created_at);
      }
    });
    return sorted;
  }, [requestsQ.data, statusFilter, empById, query, from, to, sortKey]);

  // Decision dialog state. ``mode === CANCEL`` means: admin is undoing an
  // already-decided request (APPROVED or PENDING) — backend POSTs to
  // /admin-cancel and triggers a salary recompute to flip the days back.
  const [active, setActive] = useState<LeaveRequest | null>(null);
  const [mode, setMode] = useState<"APPROVED" | "REJECTED" | "CANCEL" | null>(null);
  const [decisionNote, setDecisionNote] = useState("");

  const decisionMut = useMutation({
    mutationFn: async () => {
      if (!active || !mode) return;
      const note = decisionNote.trim() || null;
      if (mode === "CANCEL") {
        await api.post(`/leave-requests/${active.id}/admin-cancel`, {
          status: "CANCELLED",
          decision_note: note,
        });
      } else {
        await api.post(`/leave-requests/${active.id}/decision`, {
          status: mode,
          decision_note: note,
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leave-requests"] });
      qc.invalidateQueries({ queryKey: ["leave-balances"] });
      qc.invalidateQueries({ queryKey: ["salary"] });
      setActive(null);
      setMode(null);
      setDecisionNote("");
    },
  });

  const stats = useMemo(() => {
    const out = { pending: 0, approved: 0, rejected: 0, days: 0 };
    for (const r of requestsQ.data ?? []) {
      if (r.status === "PENDING") out.pending += 1;
      if (r.status === "APPROVED") {
        out.approved += 1;
        out.days += r.days;
      }
      if (r.status === "REJECTED") out.rejected += 1;
    }
    return out;
  }, [requestsQ.data]);

  return (
    <div className="space-y-5">
      {/* Stat strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile
          tone="amber"
          icon={<Clock className="size-4" />}
          label={t("leaves.stat_pending")}
          value={stats.pending}
        />
        <Tile
          tone="emerald"
          icon={<Check className="size-4" />}
          label={t("leaves.stat_approved")}
          value={stats.approved}
        />
        <Tile
          tone="rose"
          icon={<XCircle className="size-4" />}
          label={t("leaves.stat_rejected")}
          value={stats.rejected}
        />
        <Tile
          tone="brand"
          icon={<CalendarDays className="size-4" />}
          label={t("leaves.stat_days_taken")}
          value={stats.days}
        />
      </div>

      {/* Status pills + filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
          {(["", "PENDING", "APPROVED", "REJECTED"] as const).map((s) => (
            <button
              key={s || "ALL"}
              onClick={() => setStatusFilter(s)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition",
                statusFilter === s
                  ? s === "PENDING"
                    ? "bg-amber-600 text-white"
                    : s === "APPROVED"
                    ? "bg-emerald-600 text-white"
                    : s === "REJECTED"
                    ? "bg-rose-600 text-white"
                    : "bg-brand-600 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              )}
            >
              {s ? label("leave_status", s) : t("leaves.all")}
            </button>
          ))}
        </div>
        <div className="min-w-[200px] flex-1">
          <Input
            label={t("leaves.search")}
            placeholder={t("leaves.search_placeholder") ?? ""}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            prefix={<Search className="size-4" />}
          />
        </div>
        <Input
          type="date"
          label={t("leaves.range_from")}
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <Input
          type="date"
          label={t("leaves.range_to")}
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </div>

      {/* Table. The shared `Table` component already wraps in overflow-x-auto;
          we just give it a min-width so columns don't squeeze each other. */}
      <Table className="min-w-[1100px]">
        <THead>
          <TR>
            <TH className="w-1" />
            <TH className="w-12" />
            <TH>
              <SortHead
                label={t("leaves.employee")}
                active={sortKey === "name"}
                onClick={() => setSortKey("name")}
              />
            </TH>
            <TH>{t("leaves.type")}</TH>
            <TH>
              <SortHead
                label={t("leaves.dates")}
                active={sortKey === "newest" || sortKey === "oldest"}
                direction={sortKey === "oldest" ? "asc" : "desc"}
                onClick={() => setSortKey(sortKey === "newest" ? "oldest" : "newest")}
              />
            </TH>
            <TH className="text-right">
              <SortHead
                label={t("leaves.days")}
                align="right"
                active={sortKey === "days_desc" || sortKey === "days_asc"}
                direction={sortKey === "days_asc" ? "asc" : "desc"}
                onClick={() => setSortKey(sortKey === "days_desc" ? "days_asc" : "days_desc")}
              />
            </TH>
            <TH className="text-right">{t("leaves.payout_total")}</TH>
            <TH>{t("leaves.reason")}</TH>
            <TH>
              <SortHead
                label={t("leaves.status")}
                active={sortKey === "status"}
                onClick={() => setSortKey("status")}
              />
            </TH>
            <TH className="text-right">{t("common.actions")}</TH>
          </TR>
        </THead>
        <TBody>
          {requestsQ.isLoading ? (
            <TR>
              <TD colSpan={10} className="text-center text-sm text-slate-500">
                {t("common.loading")}
              </TD>
            </TR>
          ) : filtered.length === 0 ? (
            <TR>
              <TD colSpan={10} className="text-center text-sm text-slate-500">
                {t("common.no_data")}
              </TD>
            </TR>
          ) : (
            filtered.map((r) => {
              const emp = empById.get(r.employee_id);
              const tp = typeById.get(r.leave_type_id);
              const sameDay = r.start_date === r.end_date;
              const start = new Date(r.start_date).toLocaleDateString(i18n.language, {
                day: "2-digit",
                month: "short",
              });
              const end = new Date(r.end_date).toLocaleDateString(i18n.language, {
                day: "2-digit",
                month: "short",
              });
              const stripeColor =
                r.status === "PENDING"
                  ? "bg-amber-400"
                  : r.status === "APPROVED"
                  ? "bg-emerald-400"
                  : r.status === "REJECTED"
                  ? "bg-rose-400"
                  : "bg-slate-300";
              return (
                <TR key={r.id} className="group transition hover:bg-slate-50/70">
                  <TD className="!w-1 !p-0">
                    <div className={cn("h-full w-1", stripeColor)} />
                  </TD>
                  <TD>
                    {emp?.photo_url ? (
                      <img
                        src={emp.photo_url}
                        alt=""
                        className="size-9 rounded-full object-cover ring-1 ring-slate-200"
                      />
                    ) : (
                      <span className="flex size-9 items-center justify-center rounded-full bg-brand-50 text-[11px] font-semibold text-brand-700">
                        {initials(emp?.full_name ?? "•")}
                      </span>
                    )}
                  </TD>
                  <TD className="font-medium">
                    <div className="text-sm text-slate-800">{emp?.full_name ?? "—"}</div>
                    <div className="text-[11px] text-slate-400">
                      {emp?.position ?? emp?.employee_code ?? ""}
                    </div>
                  </TD>
                  <TD>
                    {tp ? (
                      <div className="flex flex-col gap-1">
                        <span className="text-sm font-medium text-slate-800">
                          {tp.name}
                        </span>
                        <Badge tone={tp.paid ? "success" : "default"}>
                          <Coins className="mr-0.5 inline size-3" />
                          {tp.paid ? t("leaves.paid") : t("leaves.unpaid")}
                        </Badge>
                      </div>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </TD>
                  <TD className="text-xs text-slate-600 tabular-nums">
                    <div className="font-medium text-slate-700">
                      {sameDay ? start : `${start} → ${end}`}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {new Date(r.start_date).getFullYear()}
                    </div>
                  </TD>
                  <TD className="text-right">
                    <span className="inline-flex min-w-[2rem] items-center justify-center rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs font-semibold text-slate-700">
                      {r.days}
                    </span>
                  </TD>
                  <TD className="text-right">
                    {tp?.paid ? (
                      <div className="inline-flex flex-col items-end gap-0.5">
                        <span
                          className={cn(
                            "text-sm font-semibold tabular-nums",
                            r.override_amount
                              ? "text-amber-700"
                              : "text-emerald-700"
                          )}
                        >
                          {r.override_amount
                            ? Math.round(Number(r.override_amount))
                                .toLocaleString("ru-RU")
                                .replace(/,/g, " ")
                            : "—"}
                        </span>
                        {r.override_amount ? (
                          <Badge tone="warning">
                            <Edit2 className="mr-0.5 inline size-3" />
                            {t("leaves.overridden")}
                          </Badge>
                        ) : r.status === "APPROVED" ? (
                          <Badge tone="success">
                            <Sparkles className="mr-0.5 inline size-3" />
                            {t("leaves.original")}
                          </Badge>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </TD>
                  <TD className="text-xs text-slate-600">
                    {r.reason ? (
                      <span className="line-clamp-1" title={r.reason}>{r.reason}</span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </TD>
                  <TD>
                    <Badge tone={statusTone(r.status)}>
                      {label("leave_status", r.status)}
                    </Badge>
                    {r.decision_note && (
                      <div className="mt-0.5 line-clamp-1 max-w-[180px] text-[10px] text-slate-400">
                        {r.decision_note}
                      </div>
                    )}
                  </TD>
                  <TD className="text-right">
                    {r.status === "PENDING" ? (
                      <div className="inline-flex gap-1">
                        <Button
                          variant="success"
                          size="sm"
                          onClick={() => {
                            setActive(r);
                            setMode("APPROVED");
                            setDecisionNote("");
                          }}
                        >
                          <Check className="size-3.5" />
                          {t("leaves.approve")}
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => {
                            setActive(r);
                            setMode("REJECTED");
                            setDecisionNote("");
                          }}
                        >
                          <X className="size-3.5" />
                          {t("leaves.reject")}
                        </Button>
                      </div>
                    ) : r.status === "APPROVED" ? (
                      <div className="inline-flex flex-col items-end gap-1">
                        <span className="text-xs text-slate-400">
                          {r.approved_at
                            ? new Date(r.approved_at).toLocaleDateString(i18n.language)
                            : "—"}
                        </span>
                        <div className="inline-flex gap-1">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => nav(`/app/leaves/${r.id}/edit`)}
                          >
                            <Pencil className="size-3.5" />
                            {t("common.edit")}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setActive(r);
                              setMode("CANCEL");
                              setDecisionNote("");
                            }}
                          >
                            <X className="size-3.5" />
                            {t("leaves.admin_cancel")}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">
                        {r.approved_at
                          ? new Date(r.approved_at).toLocaleDateString(i18n.language)
                          : "—"}
                      </span>
                    )}
                  </TD>
                </TR>
              );
            })
          )}
        </TBody>
      </Table>

      {/* Bottom breathing room so the last row isn't flush against the dialog
          stack / page edge on small viewports. */}
      <div className="h-6" />

      {/* Decision dialog — captures the reason on both approve and reject so
          the audit trail is meaningful. */}
      <Dialog
        open={!!active && !!mode}
        onClose={() => {
          setActive(null);
          setMode(null);
          setDecisionNote("");
        }}
        title={
          mode === "APPROVED"
            ? t("leaves.approve_title")
            : mode === "REJECTED"
            ? t("leaves.reject_title")
            : t("leaves.admin_cancel_title")
        }
      >
        {active && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              decisionMut.mutate();
            }}
          >
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
              <div className="font-medium text-slate-800">
                {empById.get(active.employee_id)?.full_name ?? "—"}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-slate-500">
                <Calendar className="size-3.5" />
                {active.start_date} → {active.end_date}
                <span className="font-mono">·</span>
                <span>
                  {active.days} {t("leaves.days_count")}
                </span>
              </div>
              {active.reason && (
                <div className="mt-2 italic text-slate-600">"{active.reason}"</div>
              )}
            </div>

            {mode === "APPROVED" && (
              <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                <Coins className="mt-0.5 size-4 shrink-0" />
                <p>
                  {typeById.get(active.leave_type_id)?.paid
                    ? t("leaves.approve_impact_paid", { days: active.days })
                    : t("leaves.approve_impact_unpaid", { days: active.days })}
                </p>
              </div>
            )}
            {mode === "REJECTED" && (
              <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <p>{t("leaves.reject_impact")}</p>
              </div>
            )}
            {mode === "CANCEL" && (
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <p>
                  {active.status === "APPROVED"
                    ? t("leaves.admin_cancel_impact_approved", { days: active.days })
                    : t("leaves.admin_cancel_impact_pending")}
                </p>
              </div>
            )}

            <Input
              label={t("leaves.decision_note")}
              value={decisionNote}
              onChange={(e) => setDecisionNote(e.target.value)}
              placeholder={
                mode === "APPROVED"
                  ? (t("leaves.approve_note_placeholder") ?? "")
                  : mode === "REJECTED"
                  ? (t("leaves.reject_note_placeholder") ?? "")
                  : (t("leaves.admin_cancel_note_placeholder") ?? "")
              }
              maxLength={500}
              required={mode === "REJECTED" || mode === "CANCEL"}
            />
            {decisionMut.isError && (
              <p className="text-xs text-red-600">{apiErrorMessage(decisionMut.error)}</p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setActive(null);
                  setMode(null);
                  setDecisionNote("");
                }}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                variant={mode === "APPROVED" ? "success" : "danger"}
                loading={decisionMut.isPending}
              >
                {mode === "APPROVED"
                  ? t("leaves.approve")
                  : mode === "REJECTED"
                  ? t("leaves.reject")
                  : t("leaves.admin_cancel")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </Dialog>
    </div>
  );
}

function SortHead({
  label,
  active,
  direction = "desc",
  align = "left",
  onClick,
}: {
  label: string;
  active?: boolean;
  direction?: "asc" | "desc";
  align?: "left" | "right";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide transition hover:text-brand-700",
        active ? "text-brand-700" : "text-slate-500",
        align === "right" && "flex-row-reverse"
      )}
    >
      {label}
      {active ? (
        direction === "asc" ? (
          <ArrowUp className="size-3" />
        ) : (
          <ArrowDown className="size-3" />
        )
      ) : (
        <ArrowUpDown className="size-3 opacity-40" />
      )}
    </button>
  );
}

function Tile({
  tone,
  icon,
  label,
  value,
}: {
  tone: "amber" | "emerald" | "rose" | "brand";
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  const cls = {
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
    rose: "border-rose-200 bg-rose-50 text-rose-800",
    brand: "border-brand-200 bg-brand-50 text-brand-800",
  }[tone];
  return (
    <div className={cn("flex items-center justify-between rounded-lg border px-4 py-3", cls)}>
      <div>
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide opacity-70">
          {icon}
          {label}
        </div>
        <div className="mt-0.5 text-xl font-bold tabular-nums">{value}</div>
      </div>
    </div>
  );
}
