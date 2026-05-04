import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  AlertCircle,
  KeyRound,
  ListChecks,
  Mail,
  Pencil,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  Search,
  Shield,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/Table";
import { PageHeader } from "@/components/PageHeader";
import { useEnumLabel } from "@/lib/enum";
import { useAuthStore } from "@/stores/auth";
import { cn } from "@/lib/cn";
import type { Page, Role, User } from "@/lib/types";

import { ResetPasswordDialog } from "./ResetPasswordDialog";
import {
  ROLE_TONE,
  STATUS_TONE,
  fmtDateTime,
} from "./utils";

type LifecycleFilter = "all" | "active" | "inactive";
type RoleFilter = "all" | Role;

const ROLE_FILTERS: Role[] = [
  "OWNER",
  "COMPANY_ADMIN",
  "HR_MANAGER",
  "BRANCH_MANAGER",
  "EMPLOYEE",
];

export function UsersListPage() {
  const { t, i18n } = useTranslation();
  const label = useEnumLabel();
  const nav = useNavigate();
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.user);

  const [lifecycleFilter, setLifecycleFilter] =
    useState<LifecycleFilter>("active");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [query, setQuery] = useState("");
  const [resetUser, setResetUser] = useState<User | null>(null);

  const usersQ = useQuery({
    queryKey: ["users", lifecycleFilter, roleFilter, query],
    queryFn: async () => {
      const params: Record<string, string | number | boolean> = { size: 200 };
      if (lifecycleFilter === "active") params.is_active = true;
      if (lifecycleFilter === "inactive") params.is_active = false;
      if (roleFilter !== "all") params.role = roleFilter;
      if (query.trim()) params.q = query.trim();
      return (await api.get<Page<User>>("/users", { params })).data;
    },
    refetchInterval: 60_000,
  });

  const deactivateMut = useMutation({
    mutationFn: async (id: string) => api.delete(`/users/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      toast.success(t("users_page.deactivated_done"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const reactivateMut = useMutation({
    mutationFn: async (id: string) =>
      api.post<User>(`/users/${id}/reactivate`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      toast.success(t("users_page.reactivated_done"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const hardDeleteMut = useMutation({
    mutationFn: async (id: string) =>
      api.delete(`/users/${id}`, { params: { hard: true } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      toast.success(t("users_page.deleted_done"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const items = usersQ.data?.items ?? [];

  const stats = useMemo(() => {
    const out = {
      total: items.length,
      active: 0,
      inactive: 0,
      admins: 0,
      hr: 0,
      branch: 0,
      employees: 0,
    };
    for (const u of items) {
      if (u.is_active) out.active += 1;
      else out.inactive += 1;
      if (u.role === "COMPANY_ADMIN") out.admins += 1;
      else if (u.role === "HR_MANAGER") out.hr += 1;
      else if (u.role === "BRANCH_MANAGER") out.branch += 1;
      else if (u.role === "EMPLOYEE") out.employees += 1;
    }
    return out;
  }, [items]);

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("users_page.title")}
        breadcrumbs={[{ label: t("users_page.title") }]}
        icon={<Users className="size-5" />}
        description={t("users_page.subtitle")}
        actions={
          <Button onClick={() => nav("/app/users/new")}>
            <Plus className="size-4" />
            {t("users_page.create")}
          </Button>
        }
      />

      {/* Stats strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat
          tone="brand"
          icon={<Users className="size-4" />}
          label={t("users_page.stat_total")}
          value={stats.total}
        />
        <Stat
          tone="emerald"
          icon={<Power className="size-4" />}
          label={t("users_page.stat_active")}
          value={stats.active}
        />
        <Stat
          tone="rose"
          icon={<PowerOff className="size-4" />}
          label={t("users_page.stat_inactive")}
          value={stats.inactive}
        />
        <Stat
          tone="indigo"
          icon={<Shield className="size-4" />}
          label={t("users_page.stat_admins")}
          value={stats.admins}
        />
        <Stat
          tone="amber"
          icon={<UserPlus className="size-4" />}
          label={t("users_page.stat_hr")}
          value={stats.hr}
        />
        <Stat
          tone="slate"
          icon={<UserMinus className="size-4" />}
          label={t("users_page.stat_branch")}
          value={stats.branch}
        />
      </div>

      {/* Lifecycle chips */}
      <div className="flex flex-wrap items-center gap-2">
        <Chip
          active={lifecycleFilter === "active"}
          onClick={() => setLifecycleFilter("active")}
          label={t("users_page.filter_active")}
          icon={<Power className="size-3.5" />}
        />
        <Chip
          active={lifecycleFilter === "inactive"}
          onClick={() => setLifecycleFilter("inactive")}
          label={t("users_page.filter_inactive")}
          icon={<PowerOff className="size-3.5" />}
        />
        <Chip
          active={lifecycleFilter === "all"}
          onClick={() => setLifecycleFilter("all")}
          label={t("users_page.filter_all")}
          icon={<ListChecks className="size-3.5" />}
        />

        <span className="mx-2 hidden h-6 w-px bg-slate-200 sm:inline-block" />

        <Chip
          active={roleFilter === "all"}
          onClick={() => setRoleFilter("all")}
          label={t("users_page.role_all")}
          icon={<Users className="size-3.5" />}
        />
        {ROLE_FILTERS.map((r) => (
          <Chip
            key={r}
            active={roleFilter === r}
            onClick={() => setRoleFilter(r)}
            label={label("role", r)}
            icon={<Shield className="size-3.5" />}
          />
        ))}
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[280px] flex-1">
          <Input
            label={t("users_page.search_label")}
            placeholder={t("users_page.search_placeholder") ?? ""}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            prefix={<Search className="size-4" />}
          />
        </div>
        <div className="ml-auto">
          <Button
            variant="secondary"
            onClick={() => usersQ.refetch()}
            loading={usersQ.isFetching}
          >
            <RefreshCw className="size-4" />
            {t("attendance.refresh")}
          </Button>
        </div>
      </div>

      {/* Table */}
      <Table className="min-w-[1100px]">
        <THead>
          <TR>
            <TH className="w-1" />
            <TH>{t("users_page.user")}</TH>
            <TH>{t("users_page.role")}</TH>
            <TH>{t("users_page.email")}</TH>
            <TH>{t("users_page.user_status")}</TH>
            <TH>{t("users_page.language")}</TH>
            <TH>{t("users_page.created_at")}</TH>
            <TH className="text-right">{t("common.actions")}</TH>
          </TR>
        </THead>
        <TBody>
          {usersQ.isLoading ? (
            <TR>
              <TD colSpan={8} className="text-center text-sm text-slate-500">
                {t("common.loading")}
              </TD>
            </TR>
          ) : usersQ.isError ? (
            <TR>
              <TD colSpan={8} className="text-center text-sm text-rose-600">
                {apiErrorMessage(usersQ.error)}
              </TD>
            </TR>
          ) : items.length === 0 ? (
            <TR>
              <TD colSpan={8} className="text-center text-sm text-slate-500">
                {t("common.no_data")}
              </TD>
            </TR>
          ) : (
            items.map((u) => {
              const isSelf = me?.id === u.id;
              const isOwner = u.role === "OWNER";
              return (
                <TR
                  key={u.id}
                  className={cn(
                    "transition",
                    !u.is_active && "bg-slate-50/60 hover:bg-slate-50",
                    isSelf && "ring-1 ring-brand-200"
                  )}
                >
                  <TD className="!w-1 !p-0">
                    <div
                      className={cn(
                        "h-full w-1",
                        !u.is_active
                          ? "bg-slate-300"
                          : u.role === "COMPANY_ADMIN"
                            ? "bg-indigo-500"
                            : u.role === "HR_MANAGER"
                              ? "bg-emerald-500"
                              : u.role === "BRANCH_MANAGER"
                                ? "bg-amber-500"
                                : "bg-slate-400"
                      )}
                    />
                  </TD>
                  <TD>
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "text-sm font-semibold",
                          !u.is_active
                            ? "text-slate-500 line-through"
                            : "text-slate-800"
                        )}
                      >
                        {u.full_name || u.username}
                      </span>
                      {isSelf && (
                        <Badge tone="info">{t("users_page.you_badge")}</Badge>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      @{u.username}
                    </div>
                  </TD>
                  <TD>
                    <Badge tone={ROLE_TONE[u.role]}>
                      <span className="inline-flex items-center gap-1">
                        <Shield className="size-3" />
                        {label("role", u.role)}
                      </span>
                    </Badge>
                  </TD>
                  <TD className="text-xs text-slate-700">
                    {u.email ? (
                      <a
                        href={`mailto:${u.email}`}
                        className="inline-flex items-center gap-1 hover:text-brand-700"
                      >
                        <Mail className="size-3 text-slate-400" />
                        {u.email}
                      </a>
                    ) : (
                      "—"
                    )}
                  </TD>
                  <TD>
                    <Badge tone={STATUS_TONE[u.status]}>
                      {label("user_status", u.status)}
                    </Badge>
                  </TD>
                  <TD className="text-xs text-slate-600 uppercase">
                    {u.language}
                  </TD>
                  <TD className="text-xs text-slate-500">
                    {fmtDateTime(u.created_at, i18n.language)}
                  </TD>
                  <TD className="text-right">
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => nav(`/app/users/${u.id}/edit`)}
                        className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                        title={t("common.edit") ?? undefined}
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      {!isOwner && (
                        <button
                          type="button"
                          onClick={() => setResetUser(u)}
                          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                          title={t("users_page.reset_password") ?? undefined}
                        >
                          <KeyRound className="size-3.5" />
                        </button>
                      )}
                      {u.is_active ? (
                        !isSelf &&
                        !isOwner && (
                          <button
                            type="button"
                            onClick={() => {
                              if (
                                window.confirm(
                                  t("users_page.deactivate_confirm", {
                                    name: u.username,
                                  }) ?? ""
                                )
                              ) {
                                deactivateMut.mutate(u.id);
                              }
                            }}
                            className="rounded-md p-1.5 text-amber-600 hover:bg-amber-50"
                            title={t("users_page.deactivate") ?? undefined}
                          >
                            <PowerOff className="size-3.5" />
                          </button>
                        )
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => reactivateMut.mutate(u.id)}
                            className="rounded-md p-1.5 text-emerald-600 hover:bg-emerald-50"
                            title={t("users_page.reactivate") ?? undefined}
                          >
                            <Power className="size-3.5" />
                          </button>
                          {!isSelf && !isOwner && (
                            <button
                              type="button"
                              onClick={() => {
                                if (
                                  window.confirm(
                                    t("users_page.hard_delete_confirm", {
                                      name: u.username,
                                    }) ?? ""
                                  )
                                ) {
                                  hardDeleteMut.mutate(u.id);
                                }
                              }}
                              className="rounded-md p-1.5 text-rose-600 hover:bg-rose-50"
                              title={t("users_page.hard_delete") ?? undefined}
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </TD>
                </TR>
              );
            })
          )}
        </TBody>
      </Table>

      {lifecycleFilter === "inactive" && items.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertCircle className="mr-1 inline size-3" />
          {t("users_page.inactive_hint")}
        </div>
      )}

      {resetUser && (
        <ResetPasswordDialog
          user={resetUser}
          onClose={() => setResetUser(null)}
        />
      )}
    </div>
  );
}

function Chip({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition",
        active
          ? "border-brand-600 bg-brand-600 text-white shadow-sm shadow-brand-600/30"
          : "border-slate-200 bg-white text-slate-700 hover:border-brand-300 hover:bg-brand-50/50"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function Stat({
  tone,
  icon,
  label,
  value,
}: {
  tone: "brand" | "emerald" | "rose" | "amber" | "slate" | "indigo";
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  const cls = {
    brand: "border-brand-200 bg-brand-50 text-brand-800",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
    rose: "border-rose-200 bg-rose-50 text-rose-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    slate: "border-slate-200 bg-white text-slate-700",
    indigo: "border-indigo-200 bg-indigo-50 text-indigo-800",
  }[tone];
  return (
    <div className={cn("flex items-center gap-2 rounded-lg border px-3 py-2", cls)}>
      <span className="opacity-70">{icon}</span>
      <div>
        <div className="text-[10px] uppercase tracking-wide opacity-70">
          {label}
        </div>
        <div className="text-base font-bold tabular-nums leading-tight">
          {value}
        </div>
      </div>
    </div>
  );
}
