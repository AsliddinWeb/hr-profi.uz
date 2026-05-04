import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Save } from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useEnumLabel } from "@/lib/enum";
import type { Branch, Page } from "@/lib/types";

import type { DeviceFormState } from "./utils";

type Mode = "create" | "edit";

export function DeviceForm({
  mode,
  initial,
  onSubmit,
  onCancel,
  saving,
  error,
}: {
  mode: Mode;
  initial: DeviceFormState;
  onSubmit: (
    state: DeviceFormState,
    config: Record<string, unknown>
  ) => Promise<void> | void;
  onCancel: () => void;
  saving?: boolean;
  error?: unknown;
}) {
  const { t } = useTranslation();
  const label = useEnumLabel();
  const [form, setForm] = useState<DeviceFormState>(initial);
  const [configError, setConfigError] = useState<string | null>(null);

  const branchesQ = useQuery({
    queryKey: ["branches", "for-devices"],
    queryFn: async () =>
      (await api.get<Page<Branch>>("/branches", { params: { size: 200 } })).data,
  });
  const branches = branchesQ.data?.items ?? [];

  const update = <K extends keyof DeviceFormState>(
    k: K,
    v: DeviceFormState[K]
  ) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let config: Record<string, unknown> = {};
    if (form.config.trim()) {
      try {
        const parsed = JSON.parse(form.config);
        if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) {
          setConfigError(t("devices.config_must_be_object") ?? "Must be a JSON object");
          return;
        }
        config = parsed;
      } catch (e) {
        setConfigError(`JSON: ${(e as Error).message}`);
        return;
      }
    }
    setConfigError(null);
    void onSubmit(form, config);
  };

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      {/* Identity */}
      <Section
        title={t("devices.section_identity")}
        hint={t("devices.section_identity_hint")}
      >
        <Input
          label={t("devices.name") + " *"}
          required
          value={form.name}
          onChange={(e) => update("name", e.target.value)}
          placeholder={t("devices.name_placeholder") ?? ""}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">{t("devices.vendor") + " *"}</label>
            <select
              className="input"
              value={form.vendor}
              onChange={(e) =>
                update("vendor", e.target.value as DeviceFormState["vendor"])
              }
              disabled={mode === "edit"}
            >
              <option value="HIKVISION">{label("device_vendor", "HIKVISION")}</option>
              <option value="DAHUA">{label("device_vendor", "DAHUA")}</option>
              <option value="ZKTECO">{label("device_vendor", "ZKTECO")}</option>
              <option value="GENERIC">{label("device_vendor", "GENERIC")}</option>
            </select>
            {mode === "edit" && (
              <p className="mt-1 text-[11px] text-slate-400">
                {t("devices.vendor_locked_hint")}
              </p>
            )}
          </div>
          <Input
            label={t("devices.model")}
            value={form.model}
            onChange={(e) => update("model", e.target.value)}
            placeholder="DS-K1T343"
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label={t("devices.serial_number") + " *"}
            required
            value={form.serial_number}
            onChange={(e) => update("serial_number", e.target.value)}
            disabled={mode === "edit"}
            hint={
              mode === "edit"
                ? t("devices.serial_locked_hint") ?? undefined
                : t("devices.serial_hint") ?? undefined
            }
          />
          <Input
            label={t("devices.firmware")}
            value={form.firmware_version}
            disabled
            hint={t("devices.firmware_hint") ?? undefined}
          />
        </div>
      </Section>

      {/* Placement */}
      <Section
        title={t("devices.section_placement")}
        hint={t("devices.section_placement_hint")}
      >
        <div>
          <label className="label">{t("devices.branch")}</label>
          <select
            className="input"
            value={form.branch_id}
            onChange={(e) => update("branch_id", e.target.value)}
          >
            <option value="">— {t("devices.no_branch")} —</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-slate-400">
            {t("devices.branch_hint")}
          </p>
        </div>
        <div>
          <label className="label">{t("devices.location_role")}</label>
          <select
            className="input"
            value={form.location_role}
            onChange={(e) =>
              update(
                "location_role",
                e.target.value as DeviceFormState["location_role"]
              )
            }
          >
            <option value="BOTH">{label("device_location_role", "BOTH")}</option>
            <option value="ENTRY">{label("device_location_role", "ENTRY")}</option>
            <option value="EXIT">{label("device_location_role", "EXIT")}</option>
          </select>
          <p className="mt-1 text-[11px] text-slate-400">
            {t("devices.location_role_hint")}
          </p>
        </div>
      </Section>

      {/* Network */}
      <Section
        title={t("devices.section_network")}
        hint={t("devices.section_network_hint")}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label={t("devices.ip_address")}
            value={form.ip_address}
            onChange={(e) => update("ip_address", e.target.value)}
            placeholder="192.168.1.42"
            hint={t("devices.ip_hint") ?? undefined}
          />
          <Input
            label={t("devices.mac_address")}
            value={form.mac_address}
            onChange={(e) => update("mac_address", e.target.value)}
            placeholder="AA:BB:CC:DD:EE:FF"
            hint={t("devices.mac_hint") ?? undefined}
          />
        </div>
      </Section>

      {/* Advanced — JSON config */}
      <Section
        title={t("devices.section_config")}
        hint={t("devices.section_config_hint")}
      >
        <div>
          <label className="label">{t("devices.config_json")}</label>
          <textarea
            className="input font-mono text-xs"
            rows={5}
            value={form.config}
            onChange={(e) => update("config", e.target.value)}
            placeholder='{ "face_match_threshold": 0.85 }'
          />
          <p className="mt-1 text-[11px] text-slate-400">
            {t("devices.config_hint")}
          </p>
          {configError && (
            <p className="mt-1 inline-flex items-center gap-1 text-xs text-rose-700">
              <AlertTriangle className="size-3" /> {configError}
            </p>
          )}
        </div>
      </Section>

      {/* Lifecycle (edit only) */}
      {mode === "edit" && (
        <Section
          title={t("devices.section_lifecycle")}
          hint={t("devices.section_lifecycle_hint")}
        >
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="size-4"
              checked={form.is_active}
              onChange={(e) => update("is_active", e.target.checked)}
            />
            <span>
              <span className="font-semibold">{t("devices.is_active_label")}</span>
              <span className="ml-2 text-[11px] text-slate-500">
                {form.is_active
                  ? t("devices.is_active_on_hint")
                  : t("devices.is_active_off_hint")}
              </span>
            </span>
          </label>
        </Section>
      )}

      {!!error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {apiErrorMessage(error)}
        </div>
      )}

      <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" loading={saving}>
          <Save className="size-4" />
          {mode === "edit" ? t("common.save_changes") : t("common.create")}
        </Button>
      </div>
    </form>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <header>
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        {hint && <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p>}
      </header>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
