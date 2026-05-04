import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  AlertCircle,
  Cpu,
  KeyRound,
  ListChecks,
  Pencil,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  Search,
  Trash2,
  Wifi,
  WifiOff,
  Wrench,
} from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/Table";
import { PageHeader } from "@/components/PageHeader";
import { useEnumLabel } from "@/lib/enum";
import { cn } from "@/lib/cn";
import type {
  Device,
  DeviceCreateResponse,
  DeviceStatus,
  Page,
} from "@/lib/types";

import { ApiKeyRevealDialog } from "./ApiKeyRevealDialog";
import { DeviceLogsDialog } from "./DeviceLogsDialog";
import { timeAgo } from "./utils";

type LifecycleFilter = "all" | "active" | "inactive";
type StatusFilter = "all" | DeviceStatus;

const STATUS_TONE: Record<
  DeviceStatus,
  { badge: "success" | "warning" | "danger" | "default"; icon: React.ReactNode }
> = {
  ONLINE: { badge: "success", icon: <Wifi className="size-3" /> },
  OFFLINE: { badge: "danger", icon: <WifiOff className="size-3" /> },
  MAINTENANCE: { badge: "warning", icon: <Wrench className="size-3" /> },
};

export function DevicesListPage() {
  const { t } = useTranslation();
  const label = useEnumLabel();
  const nav = useNavigate();
  const qc = useQueryClient();

  const [lifecycleFilter, setLifecycleFilter] =
    useState<LifecycleFilter>("active");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [revealedKey, setRevealedKey] = useState<{
    key: string;
    deviceName: string;
  } | null>(null);
  const [logsDevice, setLogsDevice] = useState<Device | null>(null);

  const devicesQ = useQuery({
    queryKey: ["devices", lifecycleFilter, statusFilter, query],
    queryFn: async () => {
      const params: Record<string, string | number | boolean> = { size: 100 };
      if (lifecycleFilter === "active") params.is_active = true;
      if (lifecycleFilter === "inactive") params.is_active = false;
      if (statusFilter !== "all") params.status = statusFilter;
      if (query.trim()) params.q = query.trim();
      return (await api.get<Page<Device>>("/devices", { params })).data;
    },
    refetchInterval: 30_000,
  });

  const deactivateMut = useMutation({
    mutationFn: async (id: string) => api.delete(`/devices/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["devices"] });
      toast.success(t("devices.deactivated_done"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const reactivateMut = useMutation({
    mutationFn: async (id: string) =>
      api.post<Device>(`/devices/${id}/reactivate`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["devices"] });
      toast.success(t("devices.reactivated_done"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const hardDeleteMut = useMutation({
    mutationFn: async (id: string) =>
      api.delete(`/devices/${id}`, { params: { hard: true } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["devices"] });
      toast.success(t("devices.deleted_done"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const rotateMut = useMutation({
    mutationFn: async (id: string) =>
      (await api.post<DeviceCreateResponse>(`/devices/${id}/rotate-key`)).data,
    onSuccess: (resp) => {
      qc.invalidateQueries({ queryKey: ["devices"] });
      setRevealedKey({ key: resp.api_key, deviceName: resp.device.name });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const items = devicesQ.data?.items ?? [];

  const stats = useMemo(() => {
    const out = {
      total: items.length,
      online: 0,
      offline: 0,
      maintenance: 0,
      inactive: 0,
    };
    for (const d of items) {
      if (!d.is_active) out.inactive += 1;
      else if (d.status === "ONLINE") out.online += 1;
      else if (d.status === "OFFLINE") out.offline += 1;
      else if (d.status === "MAINTENANCE") out.maintenance += 1;
    }
    return out;
  }, [items]);

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("devices.title")}
        breadcrumbs={[{ label: t("devices.title") }]}
        icon={<Cpu className="size-5" />}
        description={t("devices.subtitle")}
        actions={
          <Button onClick={() => nav("/app/devices/new")}>
            <Plus className="size-4" />
            {t("devices.create")}
          </Button>
        }
      />

      {/* Stats strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat
          tone="brand"
          icon={<Cpu className="size-4" />}
          label={t("devices.stat_total")}
          value={stats.total}
        />
        <Stat
          tone="emerald"
          icon={<Wifi className="size-4" />}
          label={t("devices.stat_online")}
          value={stats.online}
        />
        <Stat
          tone="rose"
          icon={<WifiOff className="size-4" />}
          label={t("devices.stat_offline")}
          value={stats.offline}
        />
        <Stat
          tone="amber"
          icon={<Wrench className="size-4" />}
          label={t("devices.stat_maintenance")}
          value={stats.maintenance}
        />
        <Stat
          tone="slate"
          icon={<PowerOff className="size-4" />}
          label={t("devices.stat_inactive")}
          value={stats.inactive}
        />
      </div>

      {/* Lifecycle chips */}
      <div className="flex flex-wrap items-center gap-2">
        <Chip
          active={lifecycleFilter === "active"}
          onClick={() => setLifecycleFilter("active")}
          label={t("devices.filter_active")}
          icon={<Power className="size-3.5" />}
        />
        <Chip
          active={lifecycleFilter === "inactive"}
          onClick={() => setLifecycleFilter("inactive")}
          label={t("devices.filter_inactive")}
          icon={<PowerOff className="size-3.5" />}
        />
        <Chip
          active={lifecycleFilter === "all"}
          onClick={() => setLifecycleFilter("all")}
          label={t("devices.filter_all")}
          icon={<ListChecks className="size-3.5" />}
        />
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[260px] flex-1">
          <Input
            label={t("devices.search_label")}
            placeholder={t("devices.search_placeholder") ?? ""}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            prefix={<Search className="size-4" />}
          />
        </div>
        <div>
          <label className="label">{t("devices.status")}</label>
          <select
            className="input min-w-[160px]"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          >
            <option value="all">{t("branches.status_all")}</option>
            <option value="ONLINE">{label("device_status", "ONLINE")}</option>
            <option value="OFFLINE">{label("device_status", "OFFLINE")}</option>
            <option value="MAINTENANCE">
              {label("device_status", "MAINTENANCE")}
            </option>
          </select>
        </div>
        <div className="ml-auto">
          <Button
            variant="secondary"
            onClick={() => devicesQ.refetch()}
            loading={devicesQ.isFetching}
          >
            <RefreshCw className="size-4" />
            {t("attendance.refresh")}
          </Button>
        </div>
      </div>

      {/* Table */}
      <Table className="min-w-[1000px]">
        <THead>
          <TR>
            <TH className="w-1" />
            <TH>{t("devices.name")}</TH>
            <TH>{t("devices.vendor")}</TH>
            <TH>{t("devices.serial_number")}</TH>
            <TH>{t("devices.location_role")}</TH>
            <TH>{t("devices.status")}</TH>
            <TH>{t("devices.last_seen_at")}</TH>
            <TH>{t("devices.firmware")}</TH>
            <TH className="text-right">{t("common.actions")}</TH>
          </TR>
        </THead>
        <TBody>
          {devicesQ.isLoading ? (
            <TR>
              <TD colSpan={9} className="text-center text-sm text-slate-500">
                {t("common.loading")}
              </TD>
            </TR>
          ) : devicesQ.isError ? (
            <TR>
              <TD colSpan={9} className="text-center text-sm text-rose-600">
                {apiErrorMessage(devicesQ.error)}
              </TD>
            </TR>
          ) : items.length === 0 ? (
            <TR>
              <TD colSpan={9} className="text-center text-sm text-slate-500">
                {t("common.no_data")}
              </TD>
            </TR>
          ) : (
            items.map((d) => {
              const tone = STATUS_TONE[d.status];
              return (
                <TR
                  key={d.id}
                  className={cn(
                    "transition",
                    !d.is_active &&
                      "bg-slate-50/60 text-slate-500 hover:bg-slate-50"
                  )}
                >
                  <TD className="!w-1 !p-0">
                    <div
                      className={cn(
                        "h-full w-1",
                        !d.is_active
                          ? "bg-slate-300"
                          : d.status === "ONLINE"
                            ? "bg-emerald-500"
                            : d.status === "OFFLINE"
                              ? "bg-rose-400"
                              : "bg-amber-400"
                      )}
                    />
                  </TD>
                  <TD className="font-medium">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "text-sm",
                          !d.is_active
                            ? "text-slate-500 line-through"
                            : "text-slate-800"
                        )}
                      >
                        {d.name}
                      </span>
                      {!d.is_active && (
                        <Badge tone="default">
                          {t("devices.badge_inactive")}
                        </Badge>
                      )}
                    </div>
                    {d.model && (
                      <div className="text-[11px] text-slate-400">
                        {d.model}
                      </div>
                    )}
                  </TD>
                  <TD>
                    <span className="text-xs text-slate-700">
                      {label("device_vendor", d.vendor)}
                    </span>
                  </TD>
                  <TD className="font-mono text-xs text-slate-600">
                    {d.serial_number}
                  </TD>
                  <TD>
                    <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
                      {label("device_location_role", d.location_role)}
                    </span>
                  </TD>
                  <TD>
                    {d.is_active ? (
                      <Badge tone={tone.badge}>
                        <span className="inline-flex items-center gap-1">
                          {tone.icon}
                          {label("device_status", d.status)}
                        </span>
                      </Badge>
                    ) : (
                      <Badge tone="default">
                        <span className="inline-flex items-center gap-1">
                          <PowerOff className="size-3" />
                          {t("devices.badge_inactive")}
                        </span>
                      </Badge>
                    )}
                  </TD>
                  <TD className="text-xs text-slate-500">
                    {timeAgo(d.last_seen_at)}
                  </TD>
                  <TD className="text-xs">{d.firmware_version || "—"}</TD>
                  <TD className="text-right">
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setLogsDevice(d)}
                        className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                        title={t("devices.view_logs") ?? undefined}
                      >
                        <ListChecks className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => nav(`/app/devices/${d.id}/edit`)}
                        className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                        title={t("common.edit") ?? undefined}
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      {d.is_active ? (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              if (
                                window.confirm(
                                  t("devices.rotate_key_confirm") ?? ""
                                )
                              ) {
                                rotateMut.mutate(d.id);
                              }
                            }}
                            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                            title={t("devices.rotate_key") ?? undefined}
                          >
                            <KeyRound className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (
                                window.confirm(
                                  t("devices.deactivate_confirm", {
                                    name: d.name,
                                  }) ?? ""
                                )
                              ) {
                                deactivateMut.mutate(d.id);
                              }
                            }}
                            className="rounded-md p-1.5 text-amber-600 hover:bg-amber-50"
                            title={t("devices.deactivate") ?? undefined}
                          >
                            <PowerOff className="size-3.5" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => reactivateMut.mutate(d.id)}
                            className="rounded-md p-1.5 text-emerald-600 hover:bg-emerald-50"
                            title={t("devices.reactivate") ?? undefined}
                          >
                            <Power className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (
                                window.confirm(
                                  t("devices.hard_delete_confirm", {
                                    name: d.name,
                                  }) ?? ""
                                )
                              ) {
                                hardDeleteMut.mutate(d.id);
                              }
                            }}
                            className="rounded-md p-1.5 text-rose-600 hover:bg-rose-50"
                            title={t("devices.hard_delete") ?? undefined}
                          >
                            <Trash2 className="size-3.5" />
                          </button>
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
          {t("devices.inactive_hint")}
        </div>
      )}

      {revealedKey && (
        <ApiKeyRevealDialog
          deviceName={revealedKey.deviceName}
          apiKey={revealedKey.key}
          onClose={() => setRevealedKey(null)}
        />
      )}

      {logsDevice && (
        <DeviceLogsDialog
          device={logsDevice}
          onClose={() => setLogsDevice(null)}
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
  tone: "brand" | "emerald" | "rose" | "amber" | "slate";
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
