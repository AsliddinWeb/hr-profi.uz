import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Building2,
  Network,
  Phone,
  Plus,
  Search,
  UserCheck,
  Users,
} from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/Table";
import { RowActions } from "@/components/ui/RowActions";
import { PageHeader } from "@/components/PageHeader";
import { useEnumLabel } from "@/lib/enum";
import { useAuthStore } from "@/stores/auth";
import { cn } from "@/lib/cn";
import type { Branch, Department, Employee, Page } from "@/lib/types";

type StatusFilter = "all" | "active" | "inactive";

function fmtMoney(value: string | null): string {
  if (!value) return "—";
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return "—";
  return Math.round(n).toLocaleString("ru-RU").replace(/,/g, " ");
}

export function EmployeesListPage() {
  const { t } = useTranslation();
  const label = useEnumLabel();
  const nav = useNavigate();
  const qc = useQueryClient();
  const role = useAuthStore((s) => s.user?.role);
  // Branch managers may only view + light-update — they don't onboard or
  // terminate employees. Hide create/delete affordances for them.
  const canManageRoster = role !== "BRANCH_MANAGER";

  const [query, setQuery] = useState("");
  const [branchFilter, setBranchFilter] = useState<string>("all");
  const [departmentFilter, setDepartmentFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");

  const branchesQ = useQuery({
    queryKey: ["branches", "for-employees-list"],
    queryFn: async () =>
      (await api.get<Page<Branch>>("/branches", { params: { size: 200 } })).data,
  });

  const deptsQ = useQuery({
    queryKey: ["departments", "for-employees-list"],
    queryFn: async () =>
      (await api.get<Page<Department>>("/departments", { params: { size: 200 } })).data,
  });

  const employeesQ = useQuery({
    queryKey: ["employees", "list", { branchFilter, departmentFilter, statusFilter, query }],
    queryFn: async () => {
      const params: Record<string, string | number | boolean> = { size: 200 };
      if (query.trim()) params.q = query.trim();
      if (branchFilter !== "all") params.branch_id = branchFilter;
      if (departmentFilter !== "all") params.department_id = departmentFilter;
      if (statusFilter === "active") params.is_active = true;
      if (statusFilter === "inactive") params.is_active = false;
      return (await api.get<Page<Employee>>("/employees", { params })).data;
    },
  });

  const branches = branchesQ.data?.items ?? [];
  const allDepts = deptsQ.data?.items ?? [];

  const branchById = useMemo(() => {
    const m = new Map<string, Branch>();
    for (const b of branches) m.set(b.id, b);
    return m;
  }, [branches]);

  const deptById = useMemo(() => {
    const m = new Map<string, Department>();
    for (const d of allDepts) m.set(d.id, d);
    return m;
  }, [allDepts]);

  // Department filter narrows by selected branch.
  const deptOptions = useMemo(
    () =>
      branchFilter === "all"
        ? allDepts
        : allDepts.filter((d) => d.branch_id === branchFilter),
    [allDepts, branchFilter]
  );

  // Reset dept filter if it doesn't belong to selected branch.
  if (
    departmentFilter !== "all" &&
    branchFilter !== "all" &&
    !deptOptions.find((d) => d.id === departmentFilter)
  ) {
    setDepartmentFilter("all");
  }

  const employees = employeesQ.data?.items ?? [];

  const stats = useMemo(() => {
    const items = employeesQ.data?.items ?? [];
    return {
      total: items.length,
      active: items.filter((e) => e.is_active).length,
      withLogin: items.filter((e) => e.user_id != null).length,
    };
  }, [employeesQ.data?.items]);

  const deleteMut = useMutation({
    mutationFn: async (id: string) => api.delete(`/employees/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["employees"] }),
  });

  const onTerminate = (e: Employee) => {
    if (window.confirm(t("employees.terminate_confirm", { name: e.full_name }) || "Terminate?")) {
      deleteMut.mutate(e.id);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("employees.title")}
        breadcrumbs={[{ label: t("employees.title") }]}
        icon={<Users className="size-5" />}
        description={t("employees.list_subtitle")}
        actions={
          canManageRoster && (
            <Button onClick={() => nav("/app/employees/new")}>
              <Plus className="size-4" />
              {t("employees.create")}
            </Button>
          )
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile
          icon={<Users className="size-4" />}
          label={t("employees.stat_total")}
          value={stats.total}
        />
        <StatTile
          icon={<UserCheck className="size-4 text-emerald-600" />}
          label={t("employees.stat_active")}
          value={stats.active}
        />
        <StatTile
          icon={<Phone className="size-4 text-brand-600" />}
          label={t("employees.stat_with_login")}
          value={stats.withLogin}
        />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[260px] flex-1">
          <Input
            label={t("employees.search_label")}
            placeholder={t("employees.search_placeholder") ?? ""}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            prefix={<Search className="size-4" />}
          />
        </div>
        <div>
          <label className="label">{t("employees.branch")}</label>
          <select
            className="input min-w-[180px]"
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
            className="input min-w-[180px]"
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
          >
            <option value="all">{t("departments_page.branch_all")}</option>
            {deptOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{t("branches.status")}</label>
          <select
            className="input"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          >
            <option value="all">{t("branches.status_all")}</option>
            <option value="active">{t("common.active")}</option>
            <option value="inactive">{t("common.inactive")}</option>
          </select>
        </div>
      </div>

      <Table>
        <THead>
          <TR>
            <TH className="w-14">{t("employees.photo")}</TH>
            <TH>{t("employees.full_name")}</TH>
            <TH>{t("employees.code")}</TH>
            <TH>{t("employees.position")}</TH>
            <TH>{t("employees.branch")} / {t("employees.department")}</TH>
            <TH>{t("employees.salary_type")}</TH>
            <TH className="text-right">{t("employees.amount")}</TH>
            <TH>{t("common.active")}</TH>
            <TH className="text-right">{t("common.actions")}</TH>
          </TR>
        </THead>
        <TBody>
          {employeesQ.isLoading ? (
            <TR>
              <TD colSpan={9} className="text-center text-sm text-slate-500">
                {t("common.loading")}
              </TD>
            </TR>
          ) : employeesQ.isError ? (
            <TR>
              <TD colSpan={9} className="text-center text-sm text-red-600">
                {apiErrorMessage(employeesQ.error)}
              </TD>
            </TR>
          ) : employees.length === 0 ? (
            <TR>
              <TD colSpan={9} className="px-3 py-12 text-center">
                <div className="mx-auto flex max-w-sm flex-col items-center gap-2">
                  <Users className="size-8 text-slate-300" />
                  <p className="text-sm font-medium text-slate-700">
                    {t("employees.empty_title")}
                  </p>
                  <p className="text-xs text-slate-500">{t("employees.empty_hint")}</p>
                  {canManageRoster && (
                    <Button type="button" onClick={() => nav("/app/employees/new")} className="mt-2">
                      <Plus className="size-4" />
                      {t("employees.create")}
                    </Button>
                  )}
                </div>
              </TD>
            </TR>
          ) : (
            employees.map((e) => {
              const br = e.branch_id ? branchById.get(e.branch_id) : null;
              const dp = e.department_id ? deptById.get(e.department_id) : null;
              const amount =
                e.salary_type === "MONTHLY"
                  ? e.base_salary
                  : e.salary_type === "DAILY"
                  ? e.daily_rate
                  : e.salary_type === "HOURLY"
                  ? e.hourly_rate
                  : null;
              return (
                <TR
                  key={e.id}
                  className="cursor-pointer hover:bg-slate-50"
                  onClick={() => nav(`/app/employees/${e.id}/edit`)}
                >
                  <TD>
                    <EmployeeAvatar photo={e.photo_url} name={e.full_name} />
                  </TD>
                  <TD className="font-medium">
                    <div>{e.full_name}</div>
                    {e.phone && <div className="text-xs text-slate-500">{e.phone}</div>}
                  </TD>
                  <TD className="font-mono text-xs text-slate-600">{e.employee_code}</TD>
                  <TD className="text-slate-600">{e.position || "—"}</TD>
                  <TD className="text-xs">
                    {br ? (
                      <div className="inline-flex items-center gap-1 text-slate-600">
                        <Building2 className="size-3" />
                        {br.name}
                      </div>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                    {dp && (
                      <div className="mt-0.5 inline-flex items-center gap-1 text-slate-500">
                        <Network className="size-3" />
                        {dp.name}
                      </div>
                    )}
                  </TD>
                  <TD>
                    <Badge tone="default">{label("salary_type", e.salary_type)}</Badge>
                  </TD>
                  <TD className="text-right tabular-nums">
                    {fmtMoney(amount)}
                  </TD>
                  <TD>
                    <Badge tone={e.is_active ? "success" : "danger"}>
                      {e.is_active ? t("common.active") : t("common.inactive")}
                    </Badge>
                  </TD>
                  <TD className="text-right" onClick={(ev) => ev.stopPropagation()}>
                    <RowActions
                      onEdit={() => nav(`/app/employees/${e.id}/edit`)}
                      onDelete={
                        canManageRoster && e.is_active
                          ? () => onTerminate(e)
                          : undefined
                      }
                    />
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

function StatTile({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div>
        <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
        <div className="mt-0.5 text-xl font-semibold text-slate-800">{value}</div>
      </div>
      <span className="flex size-9 items-center justify-center rounded-md bg-slate-100">
        {icon}
      </span>
    </div>
  );
}

function EmployeeAvatar({ photo, name }: { photo: string | null; name: string }) {
  if (photo) {
    return (
      <img
        src={photo}
        alt=""
        className="size-10 rounded-full object-cover ring-1 ring-slate-200"
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
    <span
      className={cn(
        "flex size-10 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700"
      )}
    >
      {initials || "•"}
    </span>
  );
}
