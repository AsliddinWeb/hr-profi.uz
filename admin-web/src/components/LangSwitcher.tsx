import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Globe } from "lucide-react";
import { cn } from "@/lib/cn";

const LANGS = [
  { code: "uz", label: "O'zbekcha", short: "UZ" },
  { code: "ru", label: "Русский", short: "RU" },
  { code: "en", label: "English", short: "EN" },
] as const;

export function LangSwitcher() {
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current = i18n.language?.slice(0, 2) || "uz";
  const shortLabel = LANGS.find((l) => l.code === current)?.short ?? "UZ";

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="btn-icon gap-1.5 px-2.5 text-xs font-semibold text-ink-700"
        aria-label="Language"
        title={LANGS.find((l) => l.code === current)?.label}
      >
        <Globe className="size-4 text-ink-500" />
        {shortLabel}
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-44 overflow-hidden rounded-xl border border-[var(--card-border)] bg-white shadow-pop">
          {LANGS.map((l) => (
            <button
              key={l.code}
              onClick={() => {
                void i18n.changeLanguage(l.code);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-ink-50",
                current === l.code && "bg-brand-50/60 text-brand-700"
              )}
            >
              <span>{l.label}</span>
              {current === l.code && <Check className="size-4" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
