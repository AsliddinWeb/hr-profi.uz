import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Building2, ImagePlus, Loader2, Trash2, Upload } from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

/**
 * Drop-in logo uploader. POSTs to ``/uploads/image`` and writes the
 * returned URL back via ``onChange``. The endpoint requires a tenant
 * scope, so the caller must pass either:
 *
 *   - `companyId` (Owner editing a specific tenant's company), or
 *   - omit it when the caller is acting on their own tenant — the
 *     upload endpoint reads ``user.company_id`` from the JWT.
 *
 * When `companyId` is null AND `mode === "create"` (no tenant exists
 * yet), we render a friendly "upload after create" placeholder
 * instead of a broken file picker.
 */
export function LogoUploader({
  value,
  onChange,
  companyId,
  fallbackName = "",
  mode = "edit",
  folder = "companies",
  size = 96,
}: {
  value: string;
  onChange: (url: string) => void;
  /** Required when caller is OWNER editing another tenant. */
  companyId?: string | null;
  /** First-letter fallback when no logo set. */
  fallbackName?: string;
  /** "create" hides the uploader and shows a placeholder hint. */
  mode?: "create" | "edit";
  /** MinIO folder under the tenant prefix. */
  folder?: string;
  /** Square preview side in px. */
  size?: number;
}) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      setErr(t("logo_uploader.too_large"));
      return;
    }
    setUploading(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const url = `/uploads/image?folder=${encodeURIComponent(folder)}${
        companyId ? `&company_id=${companyId}` : ""
      }`;
      const r = await api.post<{ url: string }>(url, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      onChange(r.data.url);
    } catch (e) {
      setErr(apiErrorMessage(e));
    } finally {
      setUploading(false);
    }
  };

  if (mode === "create") {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/60 p-4 text-center">
        <ImagePlus className="mx-auto mb-1.5 size-5 text-slate-400" />
        <p className="text-xs font-medium text-slate-700">
          {t("logo_uploader.after_create_title")}
        </p>
        <p className="mt-0.5 text-[11px] text-slate-500">
          {t("logo_uploader.after_create_hint")}
        </p>
      </div>
    );
  }

  const initials = (fallbackName || "")
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div
        className={cn(
          "relative flex shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-slate-50",
          value ? "border-slate-200" : "border-dashed border-slate-300"
        )}
        style={{ width: size, height: size }}
      >
        {value ? (
          <img
            src={value}
            alt=""
            className="size-full object-contain"
            onError={() => setErr(t("logo_uploader.load_error"))}
          />
        ) : initials ? (
          <span className="text-xl font-bold text-slate-400">{initials}</span>
        ) : (
          <Building2 className="size-7 text-slate-300" />
        )}
        {uploading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70">
            <Loader2 className="size-5 animate-spin text-brand-600" />
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            if (fileRef.current) fileRef.current.value = "";
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => fileRef.current?.click()}
            loading={uploading}
          >
            <Upload className="size-4" />
            {value ? t("logo_uploader.change") : t("logo_uploader.upload")}
          </Button>
          {value && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => onChange("")}
            >
              <Trash2 className="size-4" />
              {t("logo_uploader.remove")}
            </Button>
          )}
        </div>
        <p className="text-[11px] text-slate-500">
          {t("logo_uploader.format_hint")}
        </p>
        {err && <p className="text-[11px] text-rose-600">{err}</p>}
      </div>
    </div>
  );
}
