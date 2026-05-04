import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Crown, Trophy } from "lucide-react";

import { api } from "@/lib/api";
import { Input } from "@/components/ui/Input";
import {
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from "@/components/ui/Table";
import { cn } from "@/lib/cn";
import type {
  Branch,
  Department,
  KPILeaderboardEntry,
  Page,
} from "@/lib/types";

import { fmtMoney, fmtScore, scoreTone } from "./utils";

export function LeaderboardTab() {
  const { t } = useTranslation();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [branchId, setBranchId] = useState("");
  const [departmentId, setDepartmentId] = useState("");

  const branchesQ = useQuery({
    queryKey: ["branches", "for-leaderboard"],
    queryFn: async () =>
      (await api.get<Page<Branch>>("/branches", { params: { size: 200 } })).data,
  });
  const deptsQ = useQuery({
    queryKey: ["departments", "for-leaderboard"],
    queryFn: async () =>
      (await api.get<Page<Department>>("/departments", { params: { size: 200 } })).data,
  });

  const lbQ = useQuery({
    queryKey: ["kpi", "leaderboard", year, month, branchId, departmentId],
    queryFn: async () => {
      const params: Record<string, string | number> = { year, month, limit: 50 };
      if (branchId) params.branch_id = branchId;
      if (departmentId) params.department_id = departmentId;
      return (
        await api.get<KPILeaderboardEntry[]>("/kpi/leaderboard", { params })
      ).data;
    },
  });

  const items = lbQ.data ?? [];
  const top3 = items.slice(0, 3);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <Input
          type="number"
          label={t("kpi_page.year")}
          value={year}
          onChange={(e) => setYear(Number(e.target.value) || today.getFullYear())}
          className="w-24"
        />
        <Input
          type="number"
          min={1}
          max={12}
          label={t("kpi_page.month")}
          value={month}
          onChange={(e) => setMonth(Number(e.target.value) || today.getMonth() + 1)}
          className="w-24"
        />
        <div>
          <label className="label">{t("kpi_page.bulk_target_filiallar")}</label>
          <select
            className="input min-w-[160px]"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
          >
            <option value="">—</option>
            {(branchesQ.data?.items ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{t("kpi_page.bulk_target_bolimlar")}</label>
          <select
            className="input min-w-[160px]"
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
          >
            <option value="">—</option>
            {(deptsQ.data?.items ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Podium */}
      {top3.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {top3.map((e) => (
            <div
              key={e.employee_id}
              className={cn(
                "rounded-xl border p-4 text-center",
                e.rank === 1
                  ? "border-amber-300 bg-gradient-to-br from-amber-50 to-amber-100"
                  : e.rank === 2
                  ? "border-slate-300 bg-gradient-to-br from-slate-50 to-slate-100"
                  : "border-orange-200 bg-gradient-to-br from-orange-50 to-orange-100"
              )}
            >
              <div className="mb-2 flex items-center justify-center gap-1">
                {e.rank === 1 ? (
                  <Crown className="size-5 fill-amber-400 text-amber-500" />
                ) : (
                  <Trophy
                    className={cn(
                      "size-4",
                      e.rank === 2 ? "text-slate-400" : "text-orange-400"
                    )}
                  />
                )}
                <span
                  className={cn(
                    "text-xs font-bold uppercase tracking-wide",
                    e.rank === 1
                      ? "text-amber-700"
                      : e.rank === 2
                      ? "text-slate-600"
                      : "text-orange-700"
                  )}
                >
                  #{e.rank}
                </span>
              </div>
              <div className="text-sm font-semibold text-slate-800">
                {e.employee_name}
              </div>
              {e.employee_code && (
                <div className="text-[10px] text-slate-500">{e.employee_code}</div>
              )}
              <div className="mt-2 grid grid-cols-2 gap-1.5 text-xs">
                <div className="rounded-md bg-white/70 px-2 py-1">
                  <div className="text-[9px] uppercase opacity-60">
                    {t("kpi_page.weighted_score")}
                  </div>
                  <div className="text-base font-bold tabular-nums text-slate-800">
                    {fmtScore(e.weighted_score)}
                  </div>
                </div>
                <div className="rounded-md bg-white/70 px-2 py-1">
                  <div className="text-[9px] uppercase opacity-60">
                    {t("kpi_page.reward")}
                  </div>
                  <div className="text-base font-bold tabular-nums text-emerald-700">
                    {fmtMoney(e.total_reward)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Full ranking */}
      <Table className="min-w-[900px]">
        <THead>
          <TR>
            <TH className="w-12">#</TH>
            <TH>{t("kpi_page.employee")}</TH>
            <TH className="text-right">{t("kpi_page.score")}</TH>
            <TH className="text-right">{t("kpi_page.weighted_score")}</TH>
            <TH className="text-right">{t("kpi_page.reward")}</TH>
            <TH className="text-right">{t("kpi_page.penalty")}</TH>
            <TH className="text-right">KPI</TH>
            <TH className="text-right">✓</TH>
          </TR>
        </THead>
        <TBody>
          {lbQ.isLoading ? (
            <TR>
              <TD colSpan={8} className="text-center text-sm text-slate-500">…</TD>
            </TR>
          ) : items.length === 0 ? (
            <TR>
              <TD colSpan={8} className="text-center text-sm text-slate-500">
                {t("kpi_page.no_data_for_period")}
              </TD>
            </TR>
          ) : (
            items.map((e) => {
              const sTone = scoreTone(
                items.length
                  ? Number(e.total_score) /
                      Math.max(1, e.assignments_count)
                  : 0
              );
              return (
                <TR key={e.employee_id}>
                  <TD>
                    <span
                      className={cn(
                        "inline-flex size-7 items-center justify-center rounded-full text-xs font-bold",
                        e.rank === 1
                          ? "bg-amber-100 text-amber-800 ring-1 ring-amber-300"
                          : e.rank === 2
                          ? "bg-slate-100 text-slate-700 ring-1 ring-slate-300"
                          : e.rank === 3
                          ? "bg-orange-100 text-orange-800 ring-1 ring-orange-300"
                          : "text-slate-500"
                      )}
                    >
                      {e.rank}
                    </span>
                  </TD>
                  <TD>
                    <div className="font-semibold text-slate-800">
                      {e.employee_name}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {e.employee_code ?? ""}
                    </div>
                  </TD>
                  <TD className="text-right tabular-nums text-sm font-semibold text-slate-700">
                    <span
                      className={cn(
                        "inline-flex items-center justify-center rounded-full px-2 py-0.5 ring-1",
                        sTone.bg,
                        sTone.text,
                        sTone.ring
                      )}
                    >
                      {fmtScore(
                        e.assignments_count
                          ? Number(e.total_score) / e.assignments_count
                          : 0
                      )}
                    </span>
                  </TD>
                  <TD className="text-right tabular-nums text-sm font-bold text-slate-800">
                    {fmtScore(e.weighted_score)}
                  </TD>
                  <TD className="text-right tabular-nums text-sm font-semibold text-emerald-700">
                    {fmtMoney(e.total_reward)}
                  </TD>
                  <TD className="text-right tabular-nums text-sm font-semibold text-rose-700">
                    {Number(e.total_penalty) > 0 ? `−${fmtMoney(e.total_penalty)}` : "—"}
                  </TD>
                  <TD className="text-right tabular-nums text-xs text-slate-600">
                    {e.assignments_count}
                  </TD>
                  <TD className="text-right tabular-nums text-xs text-slate-600">
                    {e.approved_count}
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
