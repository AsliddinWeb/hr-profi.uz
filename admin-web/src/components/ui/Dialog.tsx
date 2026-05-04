import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function Dialog({ open, onClose, title, children, className }: DialogProps) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4">
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          // ``max-h`` + flex column lets us scroll the body while keeping
          // the title/close header pinned. Critical on phones where forms
          // can be much taller than the viewport.
          "relative z-10 flex max-h-[calc(100vh-1rem)] w-full max-w-lg flex-col overflow-hidden rounded-lg bg-white shadow-xl sm:max-h-[calc(100vh-2rem)]",
          className
        )}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-6 sm:py-4">
          <h3 className="truncate pr-2 text-base font-semibold">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="overflow-y-auto p-4 sm:p-6">{children}</div>
      </div>
    </div>
  );
}

export const DialogFooter = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <div className={cn("mt-6 flex justify-end gap-2 border-t border-slate-200 pt-4", className)}>
    {children}
  </div>
);
