import type { Device } from "@/lib/types";

export function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 0) return "—";
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

export interface DeviceFormState {
  name: string;
  vendor: "HIKVISION" | "DAHUA" | "ZKTECO" | "GENERIC";
  branch_id: string;
  model: string;
  firmware_version: string;
  serial_number: string;
  ip_address: string;
  mac_address: string;
  location_role: "ENTRY" | "EXIT" | "BOTH";
  config: string;
  is_active: boolean;
}

export const emptyDeviceForm: DeviceFormState = {
  name: "",
  vendor: "HIKVISION",
  branch_id: "",
  model: "",
  firmware_version: "",
  serial_number: "",
  ip_address: "",
  mac_address: "",
  location_role: "BOTH",
  config: "{}",
  is_active: true,
};

export function fromDevice(d: Device): DeviceFormState {
  return {
    name: d.name,
    vendor: d.vendor,
    branch_id: d.branch_id ?? "",
    model: d.model ?? "",
    firmware_version: d.firmware_version ?? "",
    serial_number: d.serial_number,
    ip_address: d.ip_address ?? "",
    mac_address: d.mac_address ?? "",
    location_role: d.location_role,
    config: JSON.stringify(d.config ?? {}, null, 2),
    is_active: d.is_active,
  };
}
