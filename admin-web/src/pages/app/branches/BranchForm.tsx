import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ImagePlus,
  Loader2,
  MapPin,
  Trash2,
  Upload,
} from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { MapPicker } from "@/components/MapPicker";
import { cn } from "@/lib/cn";
import type { Branch } from "@/lib/types";

export interface BranchFormValue {
  name: string;
  address: string;
  photo_url: string;
  latitude: string;
  longitude: string;
  geofence_radius_m: string;
}

export const emptyBranchForm: BranchFormValue = {
  name: "",
  address: "",
  photo_url: "",
  latitude: "",
  longitude: "",
  geofence_radius_m: "150",
};

export function branchToForm(b: Branch): BranchFormValue {
  return {
    name: b.name,
    address: b.address ?? "",
    photo_url: b.photo_url ?? "",
    latitude: b.latitude == null ? "" : String(b.latitude),
    longitude: b.longitude == null ? "" : String(b.longitude),
    geofence_radius_m: String(b.geofence_radius_m),
  };
}

export function branchFormToBody(f: BranchFormValue) {
  return {
    name: f.name.trim(),
    address: f.address.trim() || null,
    photo_url: f.photo_url || null,
    latitude: f.latitude ? Number(f.latitude) : null,
    longitude: f.longitude ? Number(f.longitude) : null,
    geofence_radius_m: Number(f.geofence_radius_m) || 150,
  };
}

interface Props {
  value: BranchFormValue;
  onChange: (next: BranchFormValue) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitting: boolean;
  submitLabel: string;
  errorMessage?: string | null;
}

export function BranchForm({
  value,
  onChange,
  onSubmit,
  onCancel,
  submitting,
  submitLabel,
  errorMessage,
}: Props) {
  const { t } = useTranslation();
  const [mapOpen, setMapOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Keep file picker reset when photo cleared, so re-uploading the same file
  // works.
  useEffect(() => {
    if (!value.photo_url && fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [value.photo_url]);

  const set = <K extends keyof BranchFormValue>(k: K, v: BranchFormValue[K]) =>
    onChange({ ...value, [k]: v });

  const handleFile = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api.post<{ url: string }>("/uploads/image?folder=branches", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      set("photo_url", r.data.url);
    } catch (err) {
      setUploadError(apiErrorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    await handleFile(f);
  };

  const initialMapCoords =
    value.latitude && value.longitude
      ? { latitude: Number(value.latitude), longitude: Number(value.longitude) }
      : null;

  const lat = value.latitude ? Number(value.latitude) : null;
  const lng = value.longitude ? Number(value.longitude) : null;
  const hasCoords = lat !== null && lng !== null && !Number.isNaN(lat) && !Number.isNaN(lng);

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {/* General */}
      <Card>
        <div className="space-y-5 p-6">
          <div>
            <h2 className="text-sm font-semibold text-slate-700">
              {t("branches.section_general")}
            </h2>
            <p className="text-xs text-slate-500">{t("branches.section_general_hint")}</p>
          </div>
          <Input
            label={t("branches.name")}
            value={value.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder={t("branches.name_placeholder") ?? ""}
            required
            maxLength={200}
          />
          <Input
            label={t("branches.address")}
            value={value.address}
            onChange={(e) => set("address", e.target.value)}
            placeholder={t("branches.address_placeholder") ?? ""}
            maxLength={500}
          />
        </div>
      </Card>

      {/* Photo */}
      <Card>
        <div className="space-y-4 p-6">
          <div>
            <h2 className="text-sm font-semibold text-slate-700">
              {t("branches.section_photo")}
            </h2>
            <p className="text-xs text-slate-500">{t("branches.section_photo_hint")}</p>
          </div>

          <div className="flex flex-wrap items-start gap-4">
            <div
              className={cn(
                "relative flex size-40 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-slate-300 bg-slate-50",
                value.photo_url && "border-solid border-slate-200"
              )}
            >
              {value.photo_url ? (
                <img
                  src={value.photo_url}
                  alt=""
                  className="size-full object-cover"
                  onError={() => setUploadError(t("branches.photo_load_error"))}
                />
              ) : (
                <ImagePlus className="size-8 text-slate-300" />
              )}
              {uploading && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/70">
                  <Loader2 className="size-5 animate-spin text-brand-600" />
                </div>
              )}
            </div>

            <div className="min-w-[220px] flex-1 space-y-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={onFileChange}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  <Upload className="size-4" />
                  {value.photo_url ? t("branches.photo_replace") : t("branches.photo_upload")}
                </Button>
                {value.photo_url && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => set("photo_url", "")}
                    disabled={uploading}
                  >
                    <Trash2 className="size-4" />
                    {t("branches.photo_remove")}
                  </Button>
                )}
              </div>
              <p className="text-xs text-slate-500">
                {t("branches.photo_constraints")}
              </p>
              {uploadError && <p className="text-xs text-red-600">{uploadError}</p>}
            </div>
          </div>
        </div>
      </Card>

      {/* Location */}
      <Card>
        <div className="space-y-5 p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-700">
                {t("branches.section_location")}
              </h2>
              <p className="text-xs text-slate-500">
                {t("branches.section_location_hint")}
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setMapOpen(true)}
            >
              <MapPin className="size-4" />
              {hasCoords ? t("branches.pick_on_map_change") : t("branches.pick_on_map")}
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label={t("branches.latitude")}
              value={value.latitude}
              // type="number" auto-formats per browser locale (e.g. "65,80"
              // instead of "65.80" in ru-RU). We render plain text + numeric
              // keypad so the picked decimal stays canonical.
              type="text"
              inputMode="decimal"
              pattern="-?\d*(\.\d+)?"
              onChange={(e) => set("latitude", e.target.value.replace(",", "."))}
              placeholder="41.311081"
            />
            <Input
              label={t("branches.longitude")}
              value={value.longitude}
              type="text"
              inputMode="decimal"
              pattern="-?\d*(\.\d+)?"
              onChange={(e) => set("longitude", e.target.value.replace(",", "."))}
              placeholder="69.240562"
            />
          </div>

          <Input
            label={t("branches.geofence_radius_m")}
            type="number"
            min="10"
            max="5000"
            value={value.geofence_radius_m}
            onChange={(e) => set("geofence_radius_m", e.target.value)}
            hint={t("branches.geofence_hint") ?? undefined}
          />
        </div>
      </Card>

      {errorMessage && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorMessage}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" loading={submitting}>
          {submitLabel}
        </Button>
      </div>

      <MapPicker
        open={mapOpen}
        onClose={() => setMapOpen(false)}
        initial={initialMapCoords}
        onPick={(c) => {
          // Update both fields in a single onChange call. Calling `set` twice
          // in a row would close over the same stale `value` and the second
          // update would clobber the first.
          onChange({
            ...value,
            latitude: c.latitude.toFixed(6),
            longitude: c.longitude.toFixed(6),
          });
        }}
      />
    </form>
  );
}
