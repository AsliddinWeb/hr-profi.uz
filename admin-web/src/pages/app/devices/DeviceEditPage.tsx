import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Cpu, KeyRound, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { api, apiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/PageHeader";
import type { Device, DeviceCreateResponse } from "@/lib/types";

import { ApiKeyRevealDialog } from "./ApiKeyRevealDialog";
import { DeviceForm } from "./DeviceForm";
import { fromDevice, type DeviceFormState } from "./utils";

export function DeviceEditPage() {
  const { id = "" } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [revealedKey, setRevealedKey] = useState<{
    key: string;
    deviceName: string;
  } | null>(null);

  const deviceQ = useQuery({
    queryKey: ["devices", id],
    queryFn: async () => (await api.get<Device>(`/devices/${id}`)).data,
    enabled: !!id,
  });

  const updateMut = useMutation({
    mutationFn: async ({
      f,
      config,
    }: {
      f: DeviceFormState;
      config: Record<string, unknown>;
    }) => {
      const body: Record<string, unknown> = {
        name: f.name,
        location_role: f.location_role,
        is_active: f.is_active,
        config,
      };
      body.branch_id = f.branch_id || null;
      body.model = f.model || null;
      body.ip_address = f.ip_address || null;
      body.mac_address = f.mac_address || null;
      return (await api.patch<Device>(`/devices/${id}`, body)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["devices"] });
      toast.success(t("common.save_changes"));
      nav("/app/devices");
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const rotateMut = useMutation({
    mutationFn: async () =>
      (
        await api.post<DeviceCreateResponse>(`/devices/${id}/rotate-key`)
      ).data,
    onSuccess: (resp) => {
      qc.invalidateQueries({ queryKey: ["devices"] });
      setRevealedKey({ key: resp.api_key, deviceName: resp.device.name });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const hardDeleteMut = useMutation({
    mutationFn: async () =>
      api.delete(`/devices/${id}`, { params: { hard: true } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["devices"] });
      toast.success(t("devices.deleted_done"));
      nav("/app/devices");
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  if (deviceQ.isLoading) {
    return <div className="p-6 text-sm text-slate-500">{t("common.loading")}</div>;
  }
  if (!deviceQ.data) {
    return (
      <div className="p-6 text-sm text-rose-600">
        {t("common.not_found")}
      </div>
    );
  }

  const d = deviceQ.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title={d.name}
        breadcrumbs={[
          { label: t("devices.title"), to: "/app/devices" },
          { label: d.name },
        ]}
        icon={<Cpu className="size-5" />}
        description={
          <span>
            <code className="font-mono text-xs">{d.serial_number}</code>
            {" · "}
            {d.vendor}
          </span>
        }
        actions={
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                if (window.confirm(t("devices.rotate_key_confirm") ?? "")) {
                  rotateMut.mutate();
                }
              }}
              loading={rotateMut.isPending}
            >
              <KeyRound className="size-4" />
              {t("devices.rotate_key")}
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={() => {
                if (
                  window.confirm(
                    t("devices.hard_delete_confirm", { name: d.name }) ?? ""
                  )
                ) {
                  hardDeleteMut.mutate();
                }
              }}
              loading={hardDeleteMut.isPending}
            >
              <Trash2 className="size-4" />
              {t("devices.hard_delete")}
            </Button>
          </div>
        }
      />

      <DeviceForm
        mode="edit"
        initial={fromDevice(d)}
        saving={updateMut.isPending}
        error={updateMut.error}
        onSubmit={async (f, config) => {
          await updateMut.mutateAsync({ f, config });
        }}
        onCancel={() => nav("/app/devices")}
      />

      {revealedKey && (
        <ApiKeyRevealDialog
          deviceName={revealedKey.deviceName}
          apiKey={revealedKey.key}
          onClose={() => setRevealedKey(null)}
        />
      )}
    </div>
  );
}
