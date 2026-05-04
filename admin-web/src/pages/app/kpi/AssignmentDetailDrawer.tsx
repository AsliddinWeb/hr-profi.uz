import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  AlertTriangle,
  Calendar,
  Check,
  Clock,
  FileText,
  History,
  RefreshCw,
  Star,
  X,
} from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { useEnumLabel } from "@/lib/enum";
import { cn } from "@/lib/cn";
import type {
  KPIAssignment,
  KPIAssignmentDetail,
  KPIAuditLogEntry,
} from "@/lib/types";

import {
  CATEGORY_COLOR,
  STATUS_TONE,
  fmtMoney,
  fmtScore,
  scoreTone,
} from "./utils";

export function AssignmentDetailDrawer({
  assignmentId,
  onClose,
}: {
  assignmentId: string;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const label = useEnumLabel();
  const qc = useQueryClient();

  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);

  const detailQ = useQuery({
    queryKey: ["kpi", "assignment", assignmentId],
    queryFn: async () =>
      (
        await api.get<KPIAssignmentDetail>(`/kpi/assignments/${assignmentId}`)
      ).data,
  });
  const auditQ = useQuery({
    queryKey: ["kpi", "assignment", assignmentId, "audit"],
    queryFn: async () =>
      (
        await api.get<KPIAuditLogEntry[]>(
          `/kpi/assignments/${assignmentId}/audit`
        )
      ).data,
  });

  const recomputeMut = useMutation({
    mutationFn: async () =>
      (
        await api.post<KPIAssignment>(
          `/kpi/assignments/${assignmentId}/recompute`
        )
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kpi"] });
      toast.success(t("kpi_page.recompute"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const cancelMut = useMutation({
    mutationFn: async () =>
      api.delete(`/kpi/assignments/${assignmentId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kpi"] });
      toast.success(t("kpi_page.cancel_assignment"));
      onClose();
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const a = detailQ.data;
  if (!a) {
    return (
      <Dialog
        open
        onClose={onClose}
        title={t("kpi_page.template")}
        className="max-w-3xl"
      >
        <div className="py-6 text-center text-sm text-slate-500">…</div>
      </Dialog>
    );
  }
  const tone = STATUS_TONE[a.status];
  const sTone = scoreTone(a.score);
  const isFinal =
    a.status === "PAID" || a.status === "REJECTED" || a.status === "CANCELLED";
  const canApprove =
    a.status === "COMPUTED" || a.status === "ACTIVE" || a.status === "APPROVED";

  return (
    <Dialog
      open
      onClose={onClose}
      title={a.template_name ?? "—"}
      className="max-w-3xl"
    >
      <div className="space-y-4">
        {/* Header card */}
        <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-800">
                {a.employee_name}
              </span>
              {a.template_category && (
                <span
                  className={cn(
                    "inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ring-1",
                    CATEGORY_COLOR[a.template_category]
                  )}
                >
                  {label("kpi_category", a.template_category)}
                </span>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
              <Calendar className="size-3" />
              <span>
                {a.year}-{String(a.month).padStart(2, "0")}
              </span>
              <span className="text-slate-300">·</span>
              <span>{a.employee_code}</span>
            </div>
          </div>
          <Badge tone={tone.badge}>
            {label("kpi_assignment_status", a.status)}
          </Badge>
        </div>

        {/* KPI tiles */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Tile
            label={t("kpi_page.target")}
            value={`${a.target}${a.template_unit ? " " + a.template_unit : ""}`}
          />
          <Tile label={t("kpi_page.actual")} value={a.actual} />
          <div
            className={cn(
              "rounded-lg px-3 py-2 ring-1",
              sTone.bg,
              sTone.text,
              sTone.ring
            )}
          >
            <div className="text-[10px] uppercase tracking-wide opacity-70">
              {t("kpi_page.score")}
            </div>
            <div className="text-lg font-bold tabular-nums leading-tight">
              {fmtScore(a.score)}%
            </div>
          </div>
          <div
            className={cn(
              "rounded-lg px-3 py-2 ring-1",
              a.is_penalty
                ? "bg-rose-50 text-rose-700 ring-rose-200"
                : "bg-emerald-50 text-emerald-700 ring-emerald-200"
            )}
          >
            <div className="text-[10px] uppercase tracking-wide opacity-70">
              {a.is_penalty ? t("kpi_page.penalty") : t("kpi_page.reward")}
            </div>
            <div className="text-lg font-bold tabular-nums leading-tight">
              {a.is_penalty ? "−" : "+"}
              {fmtMoney(a.computed_reward)}
            </div>
          </div>
        </div>

        {/* Compute error */}
        {a.last_compute_error && (
          <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div>
              <div className="font-semibold">{t("kpi_page.compute_error")}</div>
              <div className="font-mono">{a.last_compute_error}</div>
            </div>
          </div>
        )}

        {/* Inputs snapshot */}
        {a.inputs_snapshot?.vars && (
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-700">
              <FileText className="size-3.5" />
              {t("kpi_page.inputs_snapshot")}
            </div>
            <p className="mb-2 text-[11px] text-slate-500">
              {t("kpi_page.inputs_snapshot_hint")}
            </p>
            <pre className="overflow-x-auto rounded-md bg-slate-50 p-2 font-mono text-[10px] text-slate-700">
              {a.inputs_snapshot.formula}
            </pre>
            <div className="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-3">
              {Object.entries(a.inputs_snapshot.vars).map(([k, v]) => (
                <div
                  key={k}
                  className="flex items-baseline justify-between rounded-md bg-slate-50 px-2 py-1"
                >
                  <span className="font-mono text-[10px] text-slate-600">
                    {k}
                  </span>
                  <span className="tabular-nums text-xs font-semibold text-slate-800">
                    {v}
                  </span>
                </div>
              ))}
            </div>
            {a.last_computed_at && (
              <div className="mt-2 flex items-center gap-1 text-[10px] text-slate-400">
                <Clock className="size-3" />
                {new Date(a.last_computed_at).toLocaleString(i18n.language)}
              </div>
            )}
          </div>
        )}

        {/* Manager review fields */}
        {(a.manager_rating || a.manager_comment) && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-800">
              <Star className="size-3.5 fill-amber-500 text-amber-500" />
              {t("kpi_page.manager_rating")}: {a.manager_rating ?? "—"}
            </div>
            {a.manager_comment && (
              <p className="mt-1 text-xs text-amber-900">{a.manager_comment}</p>
            )}
          </div>
        )}

        {a.employee_response && (
          <div className="rounded-lg border border-sky-200 bg-sky-50/50 p-3 text-xs text-sky-900">
            <div className="font-semibold">{t("kpi_page.employee_response")}:</div>
            <p className="mt-0.5">{a.employee_response}</p>
          </div>
        )}

        {a.notes && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
            <div className="font-semibold">{t("kpi_page.notes")}:</div>
            <p className="mt-0.5 whitespace-pre-wrap">{a.notes}</p>
          </div>
        )}

        {/* Audit log */}
        <details className="rounded-lg border border-slate-200">
          <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-700">
            <History className="mr-1 inline size-3.5" />
            {t("kpi_page.audit_title")} ({auditQ.data?.length ?? 0})
          </summary>
          <div className="border-t border-slate-200 p-2">
            {auditQ.isLoading ? (
              <p className="py-2 text-center text-xs text-slate-500">…</p>
            ) : (auditQ.data?.length ?? 0) === 0 ? (
              <p className="py-2 text-center text-xs text-slate-400">—</p>
            ) : (
              <ol className="space-y-1.5">
                {auditQ.data!.map((log) => (
                  <li
                    key={log.id}
                    className="flex items-start gap-2 rounded-md bg-slate-50 px-2 py-1.5 text-[11px]"
                  >
                    <span className="rounded-md bg-white px-1.5 py-0.5 font-mono text-[9px] text-slate-600 ring-1 ring-slate-200">
                      {label("kpi_audit_event", log.event)}
                    </span>
                    <span className="flex-1">
                      {log.payload ? (
                        <code className="text-[10px] text-slate-600">
                          {JSON.stringify(log.payload)}
                        </code>
                      ) : (
                        ""
                      )}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {new Date(log.created_at).toLocaleString(i18n.language)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </details>

        {/* Actions */}
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-3">
          {!isFinal && (
            <Button
              variant="secondary"
              onClick={() => recomputeMut.mutate()}
              loading={recomputeMut.isPending}
            >
              <RefreshCw className="size-4" />
              {t("kpi_page.recompute")}
            </Button>
          )}
          {!isFinal && (
            <Button
              variant="secondary"
              onClick={() => cancelMut.mutate()}
              loading={cancelMut.isPending}
            >
              <X className="size-4" />
              {t("kpi_page.cancel_assignment")}
            </Button>
          )}
          {!isFinal && (
            <Button variant="danger" onClick={() => setRejectOpen(true)}>
              <X className="size-4" />
              {t("kpi_page.reject")}
            </Button>
          )}
          {canApprove && a.status !== "PAID" && (
            <Button onClick={() => setApproveOpen(true)}>
              <Check className="size-4" />
              {t("kpi_page.approve")}
            </Button>
          )}
        </div>
      </div>

      {approveOpen && (
        <ApproveDialog
          assignmentId={assignmentId}
          defaultReward={a.computed_reward}
          onClose={() => setApproveOpen(false)}
          onDone={() => {
            setApproveOpen(false);
            onClose();
          }}
        />
      )}
      {rejectOpen && (
        <RejectDialog
          assignmentId={assignmentId}
          onClose={() => setRejectOpen(false)}
          onDone={() => {
            setRejectOpen(false);
            onClose();
          }}
        />
      )}
    </Dialog>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="text-base font-bold tabular-nums leading-tight text-slate-800">
        {value}
      </div>
    </div>
  );
}

function ApproveDialog({
  assignmentId,
  defaultReward,
  onClose,
  onDone,
}: {
  assignmentId: string;
  defaultReward: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [rating, setRating] = useState("");
  const [comment, setComment] = useState("");
  const [override, setOverride] = useState("");

  const mut = useMutation({
    mutationFn: async () =>
      (
        await api.post<KPIAssignment>(
          `/kpi/assignments/${assignmentId}/approve`,
          {
            manager_rating: rating ? Number(rating) : null,
            manager_comment: comment || null,
            override_reward: override ? override : null,
          }
        )
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kpi"] });
      toast.success(t("kpi_page.approve"));
      onDone();
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  return (
    <Dialog open onClose={onClose} title={t("kpi_page.approve_title")}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          mut.mutate();
        }}
      >
        <p className="text-xs text-slate-500">{t("kpi_page.approve_hint")}</p>
        <Input
          type="number"
          step="0.5"
          min={1}
          max={5}
          label={t("kpi_page.manager_rating")}
          value={rating}
          onChange={(e) => setRating(e.target.value)}
        />
        <div>
          <label className="label">{t("kpi_page.manager_comment")}</label>
          <textarea
            className="input"
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </div>
        <Input
          type="number"
          step="0.01"
          min={0}
          label={t("kpi_page.override_reward")}
          placeholder={defaultReward}
          value={override}
          onChange={(e) => setOverride(e.target.value)}
        />
        <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" loading={mut.isPending}>
            <Check className="size-4" />
            {t("kpi_page.approve")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function RejectDialog({
  assignmentId,
  onClose,
  onDone,
}: {
  assignmentId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [reason, setReason] = useState("");

  const mut = useMutation({
    mutationFn: async () =>
      (
        await api.post<KPIAssignment>(
          `/kpi/assignments/${assignmentId}/reject`,
          { reason }
        )
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kpi"] });
      toast.success(t("kpi_page.reject"));
      onDone();
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  return (
    <Dialog open onClose={onClose} title={t("kpi_page.reject_title")}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!reason.trim()) {
            toast.error(t("common.required") ?? "");
            return;
          }
          mut.mutate();
        }}
      >
        <p className="text-xs text-rose-700">{t("kpi_page.reject_hint")}</p>
        <div>
          <label className="label">{t("kpi_page.reject_reason")}</label>
          <textarea
            className="input"
            rows={3}
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="danger" loading={mut.isPending}>
            <X className="size-4" />
            {t("kpi_page.reject")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
