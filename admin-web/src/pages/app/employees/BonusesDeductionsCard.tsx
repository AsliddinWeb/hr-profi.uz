import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Coins,
  Gift,
  Minus,
  Plus,
  Receipt,
  Sparkles,
  Wand2,
} from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { Dialog, DialogFooter } from "@/components/ui/Dialog";
import { Badge } from "@/components/ui/Badge";
import { useEnumLabel } from "@/lib/enum";
import { cn } from "@/lib/cn";
import type {
  Bonus,
  BonusType,
  Deduction,
  DeductionType,
  Employee,
} from "@/lib/types";

interface Props {
  employee: Employee;
}

function fmtMoney(n: string | number): string {
  const v = typeof n === "string" ? Number(n) : n;
  if (!Number.isFinite(v)) return "—";
  return Math.round(v).toLocaleString("ru-RU").replace(/,/g, " ");
}

export function BonusesDeductionsCard({ employee }: Props) {
  const { t } = useTranslation();
  const label = useEnumLabel();
  const qc = useQueryClient();

  const bonusesQ = useQuery({
    queryKey: ["bonuses", "for-employee", employee.id],
    queryFn: async () =>
      (await api.get<Bonus[]>("/bonuses", { params: { employee_id: employee.id } })).data,
    refetchInterval: 60_000,
  });

  const deductionsQ = useQuery({
    queryKey: ["deductions", "for-employee", employee.id],
    queryFn: async () =>
      (await api.get<Deduction[]>("/deductions", { params: { employee_id: employee.id } })).data,
    refetchInterval: 60_000,
  });

  const [bonusOpen, setBonusOpen] = useState(false);
  const [deductionOpen, setDeductionOpen] = useState(false);

  const bonuses = bonusesQ.data ?? [];
  const deductions = deductionsQ.data ?? [];

  // Sum the current month's totals so the admin sees the running impact.
  const monthSums = useMemo(() => {
    const today = new Date();
    const y = today.getFullYear();
    const m = today.getMonth() + 1;
    const inMonth = (iso: string) => {
      const d = new Date(iso);
      return d.getFullYear() === y && d.getMonth() + 1 === m;
    };
    return {
      bonuses: bonuses
        .filter((b) => inMonth(b.applied_date))
        .reduce((s, b) => s + Number(b.amount || 0), 0),
      deductions: deductions
        .filter((d) => inMonth(d.applied_date))
        .reduce((s, d) => s + Number(d.amount || 0), 0),
    };
  }, [bonuses, deductions]);

  return (
    <Card>
      <div className="space-y-5 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="mt-0.5 flex size-7 items-center justify-center rounded-md bg-amber-50 text-amber-700">
              <Coins className="size-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-slate-700">
                {t("employees.section_payroll_extras")}
              </h2>
              <p className="text-xs text-slate-500">
                {t("employees.section_payroll_extras_hint")}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => setBonusOpen(true)}>
              <Gift className="size-4 text-emerald-600" />
              {t("employees.add_bonus")}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setDeductionOpen(true)}>
              <Minus className="size-4 text-rose-600" />
              {t("employees.add_deduction")}
            </Button>
          </div>
        </div>

        {/* Month summary */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <SumTile
            tone="emerald"
            icon={<Sparkles className="size-4" />}
            label={t("employees.bonuses_month")}
            value={fmtMoney(monthSums.bonuses)}
          />
          <SumTile
            tone="rose"
            icon={<Receipt className="size-4" />}
            label={t("employees.deductions_month")}
            value={fmtMoney(monthSums.deductions)}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Bonuses list */}
          <div className="rounded-lg border border-emerald-100">
            <div className="flex items-center justify-between border-b border-emerald-100 bg-emerald-50/60 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">
              <span className="inline-flex items-center gap-1.5">
                <Gift className="size-3.5" />
                {t("employees.recent_bonuses")}
              </span>
              <span className="font-mono text-[10px] text-emerald-700/70">
                {bonuses.length}
              </span>
            </div>
            {bonusesQ.isLoading ? (
              <div className="px-3 py-3 text-xs text-slate-500">{t("common.loading")}</div>
            ) : bonuses.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-slate-500">
                {t("employees.bonuses_empty")}
              </div>
            ) : (
              <ul className="max-h-[260px] divide-y divide-emerald-50 overflow-y-auto">
                {bonuses.slice(0, 30).map((b) => (
                  <li key={b.id} className="px-3 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <Badge tone={b.type === "KPI" ? "info" : "success"}>
                            {label("bonus_type", b.type)}
                          </Badge>
                          {b.auto_generated && (
                            <Badge tone="default">
                              <Wand2 className="mr-0.5 inline size-3" />
                              {t("employees.auto")}
                            </Badge>
                          )}
                        </div>
                        {b.reason && (
                          <p className="mt-0.5 line-clamp-1 text-xs text-slate-600">{b.reason}</p>
                        )}
                        <p className="mt-0.5 text-[10px] text-slate-400">
                          {new Date(b.applied_date).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="text-sm font-semibold tabular-nums text-emerald-700">
                        +{fmtMoney(b.amount)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Deductions list */}
          <div className="rounded-lg border border-rose-100">
            <div className="flex items-center justify-between border-b border-rose-100 bg-rose-50/60 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-rose-700">
              <span className="inline-flex items-center gap-1.5">
                <Receipt className="size-3.5" />
                {t("employees.recent_deductions")}
              </span>
              <span className="font-mono text-[10px] text-rose-700/70">
                {deductions.length}
              </span>
            </div>
            {deductionsQ.isLoading ? (
              <div className="px-3 py-3 text-xs text-slate-500">{t("common.loading")}</div>
            ) : deductions.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-slate-500">
                {t("employees.deductions_empty")}
              </div>
            ) : (
              <ul className="max-h-[260px] divide-y divide-rose-50 overflow-y-auto">
                {deductions.slice(0, 30).map((d) => (
                  <li key={d.id} className="px-3 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <Badge tone={d.type === "PENALTY" ? "danger" : "warning"}>
                            {label("deduction_type", d.type)}
                          </Badge>
                          {d.auto_generated && (
                            <Badge tone="default">
                              <Wand2 className="mr-0.5 inline size-3" />
                              {t("employees.auto")}
                            </Badge>
                          )}
                        </div>
                        {d.reason && (
                          <p className="mt-0.5 line-clamp-1 text-xs text-slate-600">{d.reason}</p>
                        )}
                        <p className="mt-0.5 text-[10px] text-slate-400">
                          {new Date(d.applied_date).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="text-sm font-semibold tabular-nums text-rose-700">
                        −{fmtMoney(d.amount)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {bonusOpen && (
        <BonusDialog
          employee={employee}
          onClose={() => setBonusOpen(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["bonuses", "for-employee", employee.id] });
            qc.invalidateQueries({ queryKey: ["salary", "employee-today", employee.id] });
            setBonusOpen(false);
          }}
        />
      )}
      {deductionOpen && (
        <DeductionDialog
          employee={employee}
          onClose={() => setDeductionOpen(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["deductions", "for-employee", employee.id] });
            qc.invalidateQueries({ queryKey: ["salary", "employee-today", employee.id] });
            setDeductionOpen(false);
          }}
        />
      )}
    </Card>
  );
}

function SumTile({
  tone,
  icon,
  label,
  value,
}: {
  tone: "emerald" | "rose";
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  const cls = tone === "emerald"
    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : "bg-rose-50 text-rose-700 border-rose-200";
  return (
    <div className={cn("flex items-center justify-between rounded-lg border px-4 py-3", cls)}>
      <div>
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide opacity-80">
          {icon}
          {label}
        </div>
        <div className="mt-0.5 text-xl font-bold tabular-nums">{value}</div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Bonus dialog
// ----------------------------------------------------------------------------

const todayIso = () => new Date().toISOString().slice(0, 10);

function BonusDialog({
  employee,
  onClose,
  onSaved,
}: {
  employee: Employee;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const label = useEnumLabel();
  const [type, setType] = useState<BonusType>("FIXED");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(todayIso());

  const mut = useMutation({
    mutationFn: async () =>
      (await api.post<Bonus>("/bonuses", {
        employee_id: employee.id,
        type,
        amount: Number(amount) || 0,
        reason: reason.trim() || null,
        applied_date: date,
      })).data,
    onSuccess: onSaved,
  });

  return (
    <Dialog open onClose={onClose} title={t("employees.add_bonus")}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          mut.mutate();
        }}
      >
        <div>
          <label className="label">{t("employees.bonus_type")}</label>
          <select
            className="input"
            value={type}
            onChange={(e) => setType(e.target.value as BonusType)}
          >
            <option value="FIXED">{label("bonus_type", "FIXED")}</option>
            <option value="OVERTIME">{label("bonus_type", "OVERTIME")}</option>
            <option value="PROJECT">{label("bonus_type", "PROJECT")}</option>
            <option value="KPI">{label("bonus_type", "KPI")}</option>
          </select>
        </div>
        <Input
          label={t("employees.amount")}
          type="number"
          min="0"
          step="1000"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
          suffix={<span className="text-xs">{t("employees.currency_short")}</span>}
        />
        <Input
          label={t("employees.applied_date")}
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />
        <Input
          label={t("employees.reason")}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("employees.bonus_reason_placeholder") ?? ""}
          maxLength={500}
        />
        {mut.isError && (
          <p className="text-xs text-red-600">{apiErrorMessage(mut.error)}</p>
        )}
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" loading={mut.isPending}>
            <Plus className="size-4" />
            {t("employees.add_bonus")}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

// ----------------------------------------------------------------------------
// Deduction dialog
// ----------------------------------------------------------------------------

function DeductionDialog({
  employee,
  onClose,
  onSaved,
}: {
  employee: Employee;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const label = useEnumLabel();
  const [type, setType] = useState<DeductionType>("PENALTY");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(todayIso());

  const mut = useMutation({
    mutationFn: async () =>
      (await api.post<Deduction>("/deductions", {
        employee_id: employee.id,
        type,
        amount: Number(amount) || 0,
        reason: reason.trim() || null,
        applied_date: date,
      })).data,
    onSuccess: onSaved,
  });

  return (
    <Dialog open onClose={onClose} title={t("employees.add_deduction")}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          mut.mutate();
        }}
      >
        <div>
          <label className="label">{t("employees.deduction_type")}</label>
          <select
            className="input"
            value={type}
            onChange={(e) => setType(e.target.value as DeductionType)}
          >
            <option value="PENALTY">{label("deduction_type", "PENALTY")}</option>
            <option value="LATE">{label("deduction_type", "LATE")}</option>
            <option value="ABSENCE">{label("deduction_type", "ABSENCE")}</option>
            <option value="ADVANCE">{label("deduction_type", "ADVANCE")}</option>
            <option value="TAX">{label("deduction_type", "TAX")}</option>
          </select>
        </div>
        <Input
          label={t("employees.amount")}
          type="number"
          min="0"
          step="1000"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
          suffix={<span className="text-xs">{t("employees.currency_short")}</span>}
        />
        <Input
          label={t("employees.applied_date")}
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />
        <Input
          label={t("employees.reason")}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("employees.deduction_reason_placeholder") ?? ""}
          maxLength={500}
        />
        {mut.isError && (
          <p className="text-xs text-red-600">{apiErrorMessage(mut.error)}</p>
        )}
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" loading={mut.isPending}>
            <Plus className="size-4" />
            {t("employees.add_deduction")}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
