"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Share, X } from "lucide-react";

import { cn } from "@/lib/cn";

const DISMISS_KEY = "wtp.client.installHint.dismissed";

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  // iPadOS reports as Mac with touch — count those too.
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes("Mac") && "ontouchend" in document);
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // iOS exposes a non-standard navigator property; modern browsers expose
  // the display-mode media query.
  const ios = (navigator as unknown as { standalone?: boolean }).standalone;
  return (
    ios === true || window.matchMedia("(display-mode: standalone)").matches
  );
}

/**
 * One-time banner explaining how to install the PWA on iOS Safari.
 *
 * Why: iOS doesn't show a beforeinstallprompt event — the user must add
 * to home screen manually via Share → Add to Home Screen. Without this
 * banner, Push notifications and "open like an app" stay invisible.
 *
 * Hidden when:
 *   - already installed (display-mode: standalone),
 *   - non-iOS device,
 *   - user dismissed it (persisted in localStorage).
 */
export function InstallHint() {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!isIos() || isStandalone()) return;
    if (localStorage.getItem(DISMISS_KEY) === "1") return;
    setShow(true);
  }, []);

  if (!show) return null;

  return (
    <div
      className={cn(
        "card mx-auto mb-2 flex items-start gap-2 border-brand-200 bg-brand-50 p-3 text-[12px] text-brand-900"
      )}
    >
      <Share className="mt-0.5 size-4 shrink-0 text-brand-600" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{t("install.title")}</p>
        <p className="mt-0.5 text-[11px] text-brand-800/80">
          {t("install.body")}
        </p>
      </div>
      <button
        type="button"
        onClick={() => {
          localStorage.setItem(DISMISS_KEY, "1");
          setShow(false);
        }}
        aria-label={t("common.cancel")}
        className="-mr-1 -mt-1 rounded-full p-1 text-brand-700 hover:bg-brand-100"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
