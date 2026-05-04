import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Cpu } from "lucide-react";

import { api } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import type { DeviceCreateResponse } from "@/lib/types";

import { ApiKeyRevealDialog } from "./ApiKeyRevealDialog";
import { DeviceForm } from "./DeviceForm";
import { emptyDeviceForm, type DeviceFormState } from "./utils";

export function DeviceCreatePage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [revealedKey, setRevealedKey] = useState<{
    key: string;
    deviceName: string;
  } | null>(null);

  const createMut = useMutation({
    mutationFn: async ({
      f,
      config,
    }: {
      f: DeviceFormState;
      config: Record<string, unknown>;
    }) => {
      const body: Record<string, unknown> = {
        name: f.name,
        vendor: f.vendor,
        serial_number: f.serial_number,
        location_role: f.location_role,
        config,
      };
      if (f.branch_id) body.branch_id = f.branch_id;
      if (f.model) body.model = f.model;
      if (f.firmware_version) body.firmware_version = f.firmware_version;
      if (f.ip_address) body.ip_address = f.ip_address;
      if (f.mac_address) body.mac_address = f.mac_address;
      return (await api.post<DeviceCreateResponse>("/devices", body)).data;
    },
    onSuccess: (resp) => {
      setRevealedKey({ key: resp.api_key, deviceName: resp.device.name });
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("devices.create_title")}
        breadcrumbs={[
          { label: t("devices.title"), to: "/app/devices" },
          { label: t("devices.create_title") },
        ]}
        icon={<Cpu className="size-5" />}
        description={t("devices.create_subtitle")}
      />

      <DeviceForm
        mode="create"
        initial={emptyDeviceForm}
        saving={createMut.isPending}
        error={createMut.error}
        onSubmit={async (f, config) => {
          await createMut.mutateAsync({ f, config });
        }}
        onCancel={() => nav("/app/devices")}
      />

      {revealedKey && (
        <ApiKeyRevealDialog
          deviceName={revealedKey.deviceName}
          apiKey={revealedKey.key}
          onClose={() => {
            setRevealedKey(null);
            nav("/app/devices");
          }}
        />
      )}
    </div>
  );
}
