import { useTranslation } from "react-i18next";

import { cn } from "@/lib/cn";

const LANGS = [
  { code: "uz", label: "O'zbek" },
  { code: "ru", label: "Русский" },
  { code: "en", label: "English" },
];

/* Compact language pill — uses a darker palette on the gradient login
 * screen and a subtle on-card variant on the main screen. */
export function LangSwitcher({ dark = false }: { dark?: boolean }) {
  const { i18n } = useTranslation();
  const current = i18n.language.split("-")[0] || "uz";

  return (
    <div
      className={cn(
        "inline-flex overflow-hidden rounded-full text-xs font-semibold ring-1",
        dark
          ? "bg-white/10 text-white ring-white/30"
          : "bg-white text-ink-700 ring-ink-200"
      )}
    >
      {LANGS.map((l) => {
        const active = current === l.code;
        return (
          <button
            key={l.code}
            type="button"
            onClick={() => void i18n.changeLanguage(l.code)}
            className={cn(
              "px-3 py-1.5 transition",
              active
                ? dark
                  ? "bg-white text-brand-700"
                  : "bg-brand-600 text-white"
                : "hover:bg-black/5"
            )}
          >
            {l.code.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}
