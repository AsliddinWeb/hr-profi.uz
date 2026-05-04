import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronRight,
  Network,
  Plus,
  Search,
  Store,
} from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/Table";
import { RowActions } from "@/components/ui/RowActions";
import { PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/cn";
import type { Branch, Department, Page } from "@/lib/types";

type StatusFilter = "all" | "active" | "inactive";

interface DeptNode extends Department {
  children: DeptNode[];
  /** depth in the rendered tree (0 = top-level under a branch). */
  depth: number;
}

export function DepartmentsListPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();

  const [query, setQuery] = useState("");
  const [branchFilter, setBranchFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const branchesQ = useQuery({
    queryKey: ["branches", "for-dept-list"],
    queryFn: async () =>
      (await api.get<Page<Branch>>("/branches", { params: { size: 200 } })).data,
  });

  const deptsQ = useQuery({
    queryKey: ["departments"],
    queryFn: async () =>
      (await api.get<Page<Department>>("/departments", { params: { size: 200 } })).data,
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => api.delete(`/departments/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["departments"] }),
  });

  const branches = branchesQ.data?.items ?? [];
  const branchById = useMemo(() => {
    const m = new Map<string, Branch>();
    for (const b of branches) m.set(b.id, b);
    return m;
  }, [branches]);

  // Status + branch filters first, then search.
  const filtered = useMemo(() => {
    const items = deptsQ.data?.items ?? [];
    const q = query.trim().toLowerCase();
    return items.filter((d) => {
      if (statusFilter === "active" && !d.is_active) return false;
      if (statusFilter === "inactive" && d.is_active) return false;
      if (branchFilter !== "all" && d.branch_id !== branchFilter) return false;
      if (q && !d.name.toLowerCase().includes(q) && !(d.code ?? "").toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [deptsQ.data?.items, query, branchFilter, statusFilter]);

  // When searching, flatten matches (parent context becomes noisy at small
  // hits). Otherwise build a tree per branch.
  const groupedByBranch = useMemo(() => {
    const byBranch = new Map<string, Department[]>();
    for (const d of filtered) {
      const arr = byBranch.get(d.branch_id) ?? [];
      arr.push(d);
      byBranch.set(d.branch_id, arr);
    }

    const isSearching = query.trim().length > 0;
    const result: { branch: Branch | { id: string; name: string }; nodes: DeptNode[] }[] = [];

    const branchOrder = branches
      .filter((b) => byBranch.has(b.id))
      .concat(
        // Departments belonging to a branch we couldn't resolve (e.g. inactive
        // and filtered out of the branches query) — group them under a stub.
        Array.from(byBranch.keys())
          .filter((id) => !branchById.has(id))
          .map((id) => ({ id, name: t("departments_page.unknown_branch") }) as Branch)
      );

    for (const b of branchOrder) {
      const list = byBranch.get(b.id) ?? [];
      if (list.length === 0) continue;

      if (isSearching) {
        // Flat list: every match is a root with depth 0.
        const flat: DeptNode[] = list
          .slice()
          .sort((a, c) => a.name.localeCompare(c.name))
          .map((d) => ({ ...d, children: [], depth: 0 }));
        result.push({ branch: b, nodes: flat });
        continue;
      }

      // Build tree. Children whose parent isn't in the visible set become roots.
      const idToNode = new Map<string, DeptNode>();
      list.forEach((d) => idToNode.set(d.id, { ...d, children: [], depth: 0 }));
      const roots: DeptNode[] = [];
      for (const node of idToNode.values()) {
        const parent = node.parent_id ? idToNode.get(node.parent_id) : undefined;
        if (parent) {
          parent.children.push(node);
        } else {
          roots.push(node);
        }
      }
      const sortRec = (arr: DeptNode[], depth: number) => {
        arr.sort((a, c) => a.name.localeCompare(c.name));
        for (const n of arr) {
          n.depth = depth;
          if (n.children.length) sortRec(n.children, depth + 1);
        }
      };
      sortRec(roots, 0);
      result.push({ branch: b, nodes: roots });
    }

    return result;
  }, [filtered, branches, branchById, query, t]);

  const stats = useMemo(() => {
    const items = deptsQ.data?.items ?? [];
    const branchSet = new Set(items.filter((d) => d.is_active).map((d) => d.branch_id));
    return {
      total: items.length,
      active: items.filter((d) => d.is_active).length,
      branchesCovered: branchSet.size,
    };
  }, [deptsQ.data?.items]);

  const onDelete = (d: Department) => {
    if (window.confirm(t("departments_page.delete_confirm", { name: d.name }) || "Delete?")) {
      deleteMut.mutate(d.id);
    }
  };

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Flatten the tree honoring collapsed nodes for rendering.
  const renderRows = (nodes: DeptNode[]): JSX.Element[] => {
    const rows: JSX.Element[] = [];
    const walk = (arr: DeptNode[]) => {
      for (const n of arr) {
        const hasChildren = n.children.length > 0;
        const isOpen = !collapsed.has(n.id);
        rows.push(
          <TR
            key={n.id}
            className="cursor-pointer hover:bg-slate-50"
            onClick={() => nav(`/app/departments/${n.id}/edit`)}
          >
            <TD className="font-medium">
              <div
                className="flex items-center gap-1"
                style={{ paddingLeft: n.depth * 18 }}
              >
                {hasChildren ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(n.id);
                    }}
                    className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    aria-label={isOpen ? t("common.collapse") : t("common.expand")}
                  >
                    {isOpen ? (
                      <ChevronDown className="size-3.5" />
                    ) : (
                      <ChevronRight className="size-3.5" />
                    )}
                  </button>
                ) : (
                  <span className="inline-block w-4" />
                )}
                <span
                  className={cn(
                    "size-2 rounded-full",
                    n.is_active ? "bg-emerald-500" : "bg-slate-300"
                  )}
                />
                <span>{n.name}</span>
                {hasChildren && (
                  <span className="ml-1 text-xs text-slate-400">
                    ({n.children.length})
                  </span>
                )}
              </div>
            </TD>
            <TD className="font-mono text-xs text-slate-600">{n.code || "—"}</TD>
            <TD className="text-slate-600 text-sm">
              {n.description ? (
                <span className="line-clamp-1">{n.description}</span>
              ) : (
                <span className="text-slate-400">—</span>
              )}
            </TD>
            <TD>
              <Badge tone={n.is_active ? "success" : "danger"}>
                {n.is_active ? t("common.active") : t("common.inactive")}
              </Badge>
            </TD>
            <TD className="text-right" onClick={(e) => e.stopPropagation()}>
              <RowActions
                onEdit={() => nav(`/app/departments/${n.id}/edit`)}
                onDelete={n.is_active ? () => onDelete(n) : undefined}
              />
            </TD>
          </TR>
        );
        if (isOpen && hasChildren) walk(n.children);
      }
    };
    walk(nodes);
    return rows;
  };

  const isLoading = deptsQ.isLoading || branchesQ.isLoading;
  const totalVisible = filtered.length;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("departments_page.title")}
        breadcrumbs={[{ label: t("departments_page.title") }]}
        icon={<Network className="size-5" />}
        description={t("departments_page.list_subtitle")}
        actions={
          <Button onClick={() => nav("/app/departments/new")}>
            <Plus className="size-4" />
            {t("departments_page.create")}
          </Button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile
          icon={<Network className="size-4" />}
          label={t("departments_page.stat_total")}
          value={stats.total}
        />
        <StatTile
          icon={<Network className="size-4 text-emerald-600" />}
          label={t("departments_page.stat_active")}
          value={stats.active}
        />
        <StatTile
          icon={<Store className="size-4 text-brand-600" />}
          label={t("departments_page.stat_branches")}
          value={stats.branchesCovered}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[260px] flex-1">
          <Input
            label={t("departments_page.search_label")}
            placeholder={t("departments_page.search_placeholder") ?? ""}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            prefix={<Search className="size-4" />}
          />
        </div>
        <div>
          <label className="label">{t("departments_page.branch")}</label>
          <select
            className="input min-w-[200px]"
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

      {/* Table */}
      {isLoading ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          {t("common.loading")}
        </div>
      ) : totalVisible === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white px-6 py-12">
          <div className="mx-auto flex max-w-sm flex-col items-center gap-2 text-center">
            <Network className="size-8 text-slate-300" />
            <p className="text-sm font-medium text-slate-700">
              {t("departments_page.empty_title")}
            </p>
            <p className="text-xs text-slate-500">
              {branches.length === 0
                ? t("departments_page.empty_no_branches")
                : t("departments_page.empty_hint")}
            </p>
            {branches.length === 0 ? (
              <Button
                type="button"
                variant="secondary"
                className="mt-2"
                onClick={() => nav("/app/branches/new")}
              >
                <Store className="size-4" />
                {t("branches.create")}
              </Button>
            ) : (
              <Button
                type="button"
                onClick={() => nav("/app/departments/new")}
                className="mt-2"
              >
                <Plus className="size-4" />
                {t("departments_page.create")}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>{t("departments_page.name")}</TH>
              <TH>{t("departments_page.code")}</TH>
              <TH>{t("departments_page.description")}</TH>
              <TH>{t("common.active")}</TH>
              <TH className="text-right">{t("common.actions")}</TH>
            </TR>
          </THead>
          <TBody>
            {groupedByBranch.map(({ branch, nodes }) => (
              <Fragment key={branch.id}>
                <TR className="bg-slate-50">
                  <TD
                    colSpan={5}
                    className="!py-2 text-xs font-semibold uppercase tracking-wide text-slate-500"
                  >
                    <div className="flex items-center gap-2">
                      <Store className="size-3.5 text-slate-400" />
                      {branch.name}
                      <span className="text-slate-400">· {nodes.length}</span>
                    </div>
                  </TD>
                </TR>
                {renderRows(nodes)}
              </Fragment>
            ))}
          </TBody>
        </Table>
      )}

      {deptsQ.isError && (
        <p className="text-sm text-red-600">{apiErrorMessage(deptsQ.error)}</p>
      )}
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
