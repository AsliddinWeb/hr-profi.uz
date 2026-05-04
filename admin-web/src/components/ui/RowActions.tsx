import { Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/Button";

interface Props {
  onEdit?: () => void;
  onDelete?: () => void;
  deleteConfirm?: string;
  /** Extra slot rendered before edit/delete (e.g. "Rotate key", "Recompute"). */
  extra?: React.ReactNode;
  disabled?: boolean;
}

/**
 * Standard right-aligned row actions: optional extras + Edit + Delete.
 * Each handler is optional — pages mix and match (e.g. Users has no Edit
 * button yet but does show Reset password as an extra).
 */
export function RowActions({ onEdit, onDelete, deleteConfirm, extra, disabled }: Props) {
  const { t } = useTranslation();
  return (
    <div className="inline-flex items-center justify-end gap-1">
      {extra}
      {onEdit && (
        <Button variant="ghost" onClick={onEdit} disabled={disabled} aria-label={t("common.edit")}>
          <Pencil className="size-4" />
        </Button>
      )}
      {onDelete && (
        <Button
          variant="ghost"
          onClick={() => {
            if (window.confirm(deleteConfirm || t("common.delete_confirm") || "Delete?")) {
              onDelete();
            }
          }}
          disabled={disabled}
          aria-label={t("common.delete")}
        >
          <Trash2 className="size-4 text-red-600" />
        </Button>
      )}
    </div>
  );
}
