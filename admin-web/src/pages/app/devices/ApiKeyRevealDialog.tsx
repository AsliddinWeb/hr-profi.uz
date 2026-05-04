import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, KeyRound } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Dialog, DialogFooter } from "@/components/ui/Dialog";

export function ApiKeyRevealDialog({
  deviceName,
  apiKey,
  onClose,
}: {
  deviceName: string;
  apiKey: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <Dialog
      open
      onClose={onClose}
      title={t("devices.api_key_modal_title") + " — " + deviceName}
    >
      <div className="space-y-3">
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <KeyRound className="mt-0.5 size-4 shrink-0" />
          <p>{t("devices.api_key_modal_warning")}</p>
        </div>
        <div className="flex gap-2">
          <code className="flex-1 select-all break-all rounded-md bg-slate-900 p-3 font-mono text-xs text-slate-100">
            {apiKey}
          </code>
          <Button
            variant="secondary"
            onClick={() => {
              void navigator.clipboard.writeText(apiKey);
              setCopied(true);
            }}
          >
            <Copy className="size-4" />
            {copied
              ? t("devices.api_key_modal_copied")
              : t("devices.api_key_copy")}
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
        </DialogFooter>
      </div>
    </Dialog>
  );
}
