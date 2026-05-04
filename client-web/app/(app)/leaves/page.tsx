"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  CalendarDays,
  CalendarX,
  CheckCircle2,
  Clock,
  FileText,
  Plus,
  XCircle,
} from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { fmtShortDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { LeaveRequest, LeaveStatus, LeaveType } from "@/lib/types";

const STATUS_TONE: Record<LeaveStatus, { bg: string; text: string; ring: string }> = {
  PENDING: {
    bg: "bg-amber-50",
    text: "text-amber-800",
    ring: "ring-amber-200",
  },
  APPROVED: {
    bg: "bg-emerald-50",
    text: "text-emerald-800",
    ring: "ring-emerald-200",
  },
  REJECTED: {
    bg: "bg-rose-50",
    text: "text-rose-800",
    ring: "ring-rose-200",
  },
  CANCELLED: {
    bg: "bg-slate-100",
    text: "text-slate-600",
    ring: "ring-slate-200",
  },
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function diffDays(start: string, end: string): number {
  const a = new Date(start);
  const b = new Date(end);
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000)) + 1;
}

export default function LeavesPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const requestsQ = useQuery({
    queryKey: ["leaves", "me"],
    queryFn: async () =>
      (await api.get<LeaveRequest[]>("/leave-requests/me")).data,
  });

  const typesQ = useQuery({
    queryKey: ["leaves", "types"],
    queryFn: async () =>
      (await api.get<LeaveType[]>("/leave-types")).data,
    staleTime: 5 * 60_000,
  });

  const cancelMut = useMutation({
    mutationFn: async (id: string) =>
      (await api.post(`/leave-requests/${id}/cancel`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leaves", "me"] });
      toast.success(t("leaves.cancelled_ok"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const requests = requestsQ.data ?? [];
  const types = useMemo(
    () => (typesQ.data ?? []).filter((t) => t.is_active),
    [typesQ.data]
  );
  const typeById = useMemo(() => {
    const m = new Map<string, LeaveType>();
    for (const t of typesQ.data ?? []) m.set(t.id, t);
    return m;
  }, [typesQ.data]);

  return (
    <div className="space-y-4">
      <header className="flex items-baseline justify-between pt-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            {t("leaves.title")}
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {t("leaves.subtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((s) => !s)}
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold transition",
            showForm
              ? "bg-slate-100 text-slate-700"
              : "bg-brand-600 text-white shadow-sm shadow-brand-600/30"
          )}
        >
          {showForm ? (
            <>
              <XCircle className="size-3.5" />
              {t("common.cancel")}
            </>
          ) : (
            <>
              <Plus className="size-3.5" />
              {t("leaves.new_request")}
            </>
          )}
        </button>
      </header>

      {showForm && (
        <NewRequestForm
          types={types}
          onCancel={() => setShowForm(false)}
          onCreated={() => {
            setShowForm(false);
            qc.invalidateQueries({ queryKey: ["leaves", "me"] });
          }}
        />
      )}

      {requestsQ.isLoading ? (
        <p className="py-8 text-center text-sm text-slate-500">
          {t("common.loading")}
        </p>
      ) : requests.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 p-10 text-center">
          <CalendarX className="size-8 text-slate-300" />
          <p className="text-sm font-medium text-slate-600">
            {t("leaves.no_requests")}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {requests.map((r) => {
            const tone = STATUS_TONE[r.status];
            const lt = typeById.get(r.leave_type_id);
            return (
              <li key={r.id} className="card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                      <CalendarDays className="size-4 text-brand-600" />
                      {lt?.name ?? "—"}
                      {lt?.paid === false && (
                        <span className="rounded-full bg-slate-100 px-1.5 text-[9px] font-bold uppercase text-slate-500">
                          {t("leaves.unpaid")}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                      <span className="font-mono tabular-nums">
                        {fmtShortDate(r.start_date, i18n.language)} —{" "}
                        {fmtShortDate(r.end_date, i18n.language)}
                      </span>
                      <span className="rounded-full bg-slate-100 px-1.5 text-[10px] font-semibold text-slate-700">
                        {r.days} {t("leaves.days")}
                      </span>
                    </div>
                    {r.reason && (
                      <p className="mt-1.5 line-clamp-2 text-[11px] text-slate-500">
                        {r.reason}
                      </p>
                    )}
                    {r.decision_note && (
                      <p className="mt-1.5 rounded-md bg-amber-50 p-1.5 text-[11px] text-amber-900 ring-1 ring-amber-200">
                        <span className="font-semibold">
                          {t("leaves.decision_note")}:{" "}
                        </span>
                        {r.decision_note}
                      </p>
                    )}
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ring-1",
                      tone.bg,
                      tone.text,
                      tone.ring
                    )}
                  >
                    {t(`leaves.status_${r.status.toLowerCase()}`)}
                  </span>
                </div>
                {r.status === "PENDING" && (
                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => cancelMut.mutate(r.id)}
                      disabled={cancelMut.isPending}
                      className="text-[11px] font-semibold text-rose-600 hover:underline disabled:opacity-50"
                    >
                      {t("leaves.cancel_request")}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function NewRequestForm({
  types,
  onCancel,
  onCreated,
}: {
  types: LeaveType[];
  onCancel: () => void;
  onCreated: () => void;
}) {
  const { t } = useTranslation();
  const [typeId, setTypeId] = useState<string>(types[0]?.id ?? "");
  const [start, setStart] = useState<string>(todayISO());
  const [end, setEnd] = useState<string>(todayISO());
  const [reason, setReason] = useState<string>("");
  const [docUrl, setDocUrl] = useState<string>("");

  const submitMut = useMutation({
    mutationFn: async () => {
      if (!typeId) throw new Error(t("leaves.err_no_type"));
      if (!start || !end) throw new Error(t("leaves.err_no_dates"));
      if (new Date(end) < new Date(start)) {
        throw new Error(t("leaves.err_end_before_start"));
      }
      return (
        await api.post<LeaveRequest>("/leave-requests", {
          leave_type_id: typeId,
          start_date: start,
          end_date: end,
          reason: reason.trim() || null,
          document_url: docUrl.trim() || null,
        })
      ).data;
    },
    onSuccess: () => {
      toast.success(t("leaves.created_ok"));
      onCreated();
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const selectedType = types.find((tp) => tp.id === typeId);
  const days = diffDays(start, end);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submitMut.mutate();
      }}
      className="card space-y-3 p-4"
    >
      <div>
        <label className="label">{t("leaves.type")}</label>
        <select
          className="input"
          value={typeId}
          onChange={(e) => setTypeId(e.target.value)}
          required
        >
          <option value="" disabled>
            {t("leaves.choose_type")}
          </option>
          {types.map((tp) => (
            <option key={tp.id} value={tp.id}>
              {tp.name} {tp.paid ? "" : `(${t("leaves.unpaid")})`}
            </option>
          ))}
        </select>
        {selectedType?.requires_document && (
          <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-700">
            <FileText className="size-3" />
            {t("leaves.document_required")}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label">{t("leaves.start_date")}</label>
          <input
            type="date"
            className="input"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            min={todayISO()}
            required
          />
        </div>
        <div>
          <label className="label">{t("leaves.end_date")}</label>
          <input
            type="date"
            className="input"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            min={start}
            required
          />
        </div>
      </div>

      <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs">
        <span className="font-semibold text-slate-700">
          {t("leaves.total_days")}:
        </span>{" "}
        <span className="font-mono font-bold text-slate-900">{days}</span>
      </div>

      <div>
        <label className="label">{t("leaves.reason")}</label>
        <textarea
          className="input min-h-[80px]"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          placeholder={t("leaves.reason_placeholder")}
        />
      </div>

      {selectedType?.requires_document && (
        <div>
          <label className="label">{t("leaves.document_url")}</label>
          <input
            type="url"
            className="input"
            value={docUrl}
            onChange={(e) => setDocUrl(e.target.value)}
            placeholder="https://..."
          />
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="btn-secondary btn-block"
        >
          {t("common.cancel")}
        </button>
        <button
          type="submit"
          disabled={submitMut.isPending}
          className="btn-primary btn-block"
        >
          {submitMut.isPending ? (
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3.5 animate-spin" />
              {t("common.loading")}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <CheckCircle2 className="size-3.5" />
              {t("leaves.submit")}
            </span>
          )}
        </button>
      </div>
    </form>
  );
}
