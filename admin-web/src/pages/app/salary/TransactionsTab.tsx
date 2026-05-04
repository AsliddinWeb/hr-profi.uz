import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CreditCard, Plus, Search } from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/Table";
import { useEnumLabel } from "@/lib/enum";
import type { Employee, Page, SalaryTransaction, TransactionType } from "@/lib/types";

import { fmtMoney, fmtMoneyZero, initials } from "./utils";

type TypeFilter = "all" | TransactionType;

export function TransactionsTab() {
  const { t, i18n } = useTranslation();
  const label = useEnumLabel();
  const nav = useNavigate();

  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  const txQ = useQuery({
    queryKey: ["salary", "transactions"],
    queryFn: async () =>
      (await api.get<SalaryTransaction[]>("/salary/transactions")).data,
    refetchInterval: 60_000,
  });
  const empQ = useQuery({
    queryKey: ["employees", "for-tx"],
    queryFn: async () =>
      (await api.get<Page<Employee>>("/employees", { params: { size: 200 } })).data,
  });

  const empById = useMemo(
    () => new Map(empQ.data?.items.map((e) => [e.id, e]) ?? []),
    [empQ.data]
  );

  const filtered = useMemo(() => {
    const all = txQ.data ?? [];
    const q = query.trim().toLowerCase();
    return all.filter((tx) => {
      if (typeFilter !== "all" && tx.type !== typeFilter) return false;
      if (q) {
        const emp = empById.get(tx.employee_id);
        if (
          !emp?.full_name.toLowerCase().includes(q) &&
          !(emp?.employee_code ?? "").toLowerCase().includes(q) &&
          !(tx.reference ?? "").toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
  }, [txQ.data, typeFilter, query, empById]);

  const totals = useMemo(() => {
    const sum = (rows: SalaryTransaction[]) =>
      rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const all = txQ.data ?? [];
    return {
      total: sum(all),
      advance: sum(all.filter((r) => r.type === "ADVANCE")),
      full: sum(all.filter((r) => r.type === "FULL_PAYMENT")),
      bonus: sum(all.filter((r) => r.type === "BONUS")),
    };
  }, [txQ.data]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[260px] flex-1">
          <Input
            label={t("salary_page.search_label")}
            placeholder={t("salary_page.tx_search_placeholder") ?? ""}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            prefix={<Search className="size-4" />}
          />
        </div>
        <div>
          <label className="label">{t("leaves.type")}</label>
          <select
            className="input min-w-[160px]"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
          >
            <option value="all">{t("branches.status_all")}</option>
            <option value="ADVANCE">{label("transaction_type", "ADVANCE")}</option>
            <option value="FULL_PAYMENT">{label("transaction_type", "FULL_PAYMENT")}</option>
            <option value="BONUS">{label("transaction_type", "BONUS")}</option>
          </select>
        </div>
        <Button onClick={() => nav("/app/salary/transactions/new")} className="ml-auto">
          <Plus className="size-4" />
          {t("salary_page.record_payment")}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile
          tone="brand"
          label={t("salary_page.tx_total")}
          value={fmtMoneyZero(totals.total)}
        />
        <Tile
          tone="amber"
          label={label("transaction_type", "ADVANCE")}
          value={fmtMoneyZero(totals.advance)}
        />
        <Tile
          tone="emerald"
          label={label("transaction_type", "FULL_PAYMENT")}
          value={fmtMoneyZero(totals.full)}
        />
        <Tile
          tone="info"
          label={label("transaction_type", "BONUS")}
          value={fmtMoneyZero(totals.bonus)}
        />
      </div>

      <Table className="min-w-[900px]">
        <THead>
          <TR>
            <TH>{t("attendance.when")}</TH>
            <TH>{t("salary_page.employee")}</TH>
            <TH>{t("leaves.type")}</TH>
            <TH>{t("salary_page.payment_method")}</TH>
            <TH>{t("salary_page.payment_reference")}</TH>
            <TH className="text-right">{t("employees.amount")}</TH>
          </TR>
        </THead>
        <TBody>
          {txQ.isLoading ? (
            <TR>
              <TD colSpan={6} className="text-center text-sm text-slate-500">
                {t("common.loading")}
              </TD>
            </TR>
          ) : txQ.isError ? (
            <TR>
              <TD colSpan={6} className="text-center text-sm text-red-600">
                {apiErrorMessage(txQ.error)}
              </TD>
            </TR>
          ) : filtered.length === 0 ? (
            <TR>
              <TD colSpan={6} className="text-center text-sm text-slate-500">
                {t("common.no_data")}
              </TD>
            </TR>
          ) : (
            filtered.map((tx) => {
              const emp = empById.get(tx.employee_id);
              return (
                <TR key={tx.id}>
                  <TD className="text-xs tabular-nums text-slate-600">
                    {new Date(tx.paid_at).toLocaleDateString(i18n.language)}
                  </TD>
                  <TD>
                    <div className="flex items-center gap-2">
                      {emp?.photo_url ? (
                        <img
                          src={emp.photo_url}
                          alt=""
                          className="size-8 rounded-full object-cover ring-1 ring-slate-200"
                        />
                      ) : (
                        <span className="flex size-8 items-center justify-center rounded-full bg-brand-50 text-[10px] font-semibold text-brand-700">
                          {initials(emp?.full_name ?? "•")}
                        </span>
                      )}
                      <div>
                        <div className="text-sm font-medium">
                          {emp?.full_name ?? tx.employee_id.slice(0, 8)}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {emp?.employee_code}
                        </div>
                      </div>
                    </div>
                  </TD>
                  <TD>
                    <Badge
                      tone={
                        tx.type === "ADVANCE"
                          ? "warning"
                          : tx.type === "FULL_PAYMENT"
                          ? "success"
                          : "info"
                      }
                    >
                      <CreditCard className="mr-0.5 inline size-3" />
                      {label("transaction_type", tx.type)}
                    </Badge>
                  </TD>
                  <TD className="text-xs text-slate-600">{tx.payment_method ?? "—"}</TD>
                  <TD className="text-xs text-slate-600">{tx.reference ?? "—"}</TD>
                  <TD className="text-right tabular-nums font-semibold">
                    {fmtMoney(tx.amount)}
                  </TD>
                </TR>
              );
            })
          )}
        </TBody>
      </Table>
    </div>
  );
}

function Tile({
  tone,
  label,
  value,
}: {
  tone: "brand" | "amber" | "emerald" | "info";
  label: string;
  value: string;
}) {
  const cls = {
    brand: "border-brand-200 bg-brand-50 text-brand-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
    info: "border-sky-200 bg-sky-50 text-sky-800",
  }[tone];
  return (
    <div className={`rounded-lg border px-4 py-3 ${cls}`}>
      <div className="text-[10px] uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-0.5 text-base font-bold tabular-nums">{value}</div>
    </div>
  );
}
