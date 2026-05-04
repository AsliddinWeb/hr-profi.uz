import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Map as MapIcon,
  MapPin,
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
import type { Branch, Page } from "@/lib/types";

type StatusFilter = "all" | "active" | "inactive";

export function BranchesListPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["app", "branches", { statusFilter }],
    queryFn: async () => {
      const params: Record<string, string | number | boolean> = { size: 200 };
      if (statusFilter === "active") params.is_active = true;
      if (statusFilter === "inactive") params.is_active = false;
      return (await api.get<Page<Branch>>("/branches", { params })).data;
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => api.delete(`/branches/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["app", "branches"] }),
  });

  const filtered = useMemo(() => {
    const items = data?.items ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        (b.address ?? "").toLowerCase().includes(q)
    );
  }, [data?.items, query]);

  const stats = useMemo(() => {
    const items = data?.items ?? [];
    return {
      total: items.length,
      active: items.filter((b) => b.is_active).length,
      withCoords: items.filter((b) => b.latitude != null && b.longitude != null).length,
    };
  }, [data?.items]);

  const onDelete = (b: Branch) => {
    if (window.confirm(t("branches.delete_confirm", { name: b.name }) || "Delete?")) {
      deleteMut.mutate(b.id);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("branches.title")}
        breadcrumbs={[{ label: t("branches.title") }]}
        icon={<Store className="size-5" />}
        description={t("branches.list_subtitle")}
        actions={
          <Button onClick={() => nav("/app/branches/new")}>
            <Plus className="size-4" />
            {t("branches.create")}
          </Button>
        }
      />

      {/* Stat strip */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile
          icon={<Store className="size-4" />}
          label={t("branches.stat_total")}
          value={stats.total}
        />
        <StatTile
          icon={<Store className="size-4 text-emerald-600" />}
          label={t("branches.stat_active")}
          value={stats.active}
        />
        <StatTile
          icon={<MapIcon className="size-4 text-brand-600" />}
          label={t("branches.stat_with_coords")}
          value={stats.withCoords}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[260px] flex-1">
          <Input
            label={t("branches.search_label")}
            placeholder={t("branches.search_placeholder") ?? ""}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            prefix={<Search className="size-4" />}
          />
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
      <Table>
        <THead>
          <TR>
            <TH className="w-16">{t("branches.photo")}</TH>
            <TH>{t("branches.name")}</TH>
            <TH>{t("branches.address")}</TH>
            <TH>{t("branches.coords")}</TH>
            <TH>{t("branches.geofence_radius_m")}</TH>
            <TH>{t("common.active")}</TH>
            <TH className="text-right">{t("common.actions")}</TH>
          </TR>
        </THead>
        <TBody>
          {isLoading ? (
            <TR>
              <TD colSpan={7} className="text-center text-sm text-slate-500">
                {t("common.loading")}
              </TD>
            </TR>
          ) : isError ? (
            <TR>
              <TD colSpan={7} className="text-center text-sm text-red-600">
                {apiErrorMessage(error)}
              </TD>
            </TR>
          ) : filtered.length === 0 ? (
            <TR>
              <TD colSpan={7} className="px-3 py-10 text-center">
                <div className="mx-auto flex max-w-sm flex-col items-center gap-2">
                  <Store className="size-8 text-slate-300" />
                  <p className="text-sm font-medium text-slate-700">
                    {t("branches.empty_title")}
                  </p>
                  <p className="text-xs text-slate-500">
                    {t("branches.empty_hint")}
                  </p>
                  <Button
                    type="button"
                    onClick={() => nav("/app/branches/new")}
                    className="mt-2"
                  >
                    <Plus className="size-4" />
                    {t("branches.create")}
                  </Button>
                </div>
              </TD>
            </TR>
          ) : (
            filtered.map((b) => (
              <TR
                key={b.id}
                className="cursor-pointer hover:bg-slate-50"
                onClick={() => nav(`/app/branches/${b.id}/edit`)}
              >
                <TD>
                  <BranchAvatar photo={b.photo_url} name={b.name} />
                </TD>
                <TD className="font-medium">{b.name}</TD>
                <TD className="text-slate-600">{b.address || "—"}</TD>
                <TD>
                  {b.latitude != null && b.longitude != null ? (
                    <a
                      href={`https://yandex.com/maps/?ll=${b.longitude},${b.latitude}&z=16&pt=${b.longitude},${b.latitude}`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 font-mono text-xs text-brand-600 hover:underline"
                    >
                      <MapPin className="size-3.5" />
                      {b.latitude.toFixed(4)}, {b.longitude.toFixed(4)}
                    </a>
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  )}
                </TD>
                <TD>{b.geofence_radius_m} m</TD>
                <TD>
                  <Badge tone={b.is_active ? "success" : "danger"}>
                    {b.is_active ? t("common.active") : t("common.inactive")}
                  </Badge>
                </TD>
                <TD className="text-right" onClick={(e) => e.stopPropagation()}>
                  <RowActions
                    onEdit={() => nav(`/app/branches/${b.id}/edit`)}
                    onDelete={b.is_active ? () => onDelete(b) : undefined}
                  />
                </TD>
              </TR>
            ))
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

function BranchAvatar({ photo, name }: { photo: string | null; name: string }) {
  if (photo) {
    return (
      <img
        src={photo}
        alt=""
        className="size-10 rounded-md object-cover ring-1 ring-slate-200"
      />
    );
  }
  // Fallback: 2-letter initial chip
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span
      className={cn(
        "flex size-10 items-center justify-center rounded-md bg-brand-50 text-xs font-semibold text-brand-700"
      )}
    >
      {initials || "•"}
    </span>
  );
}
