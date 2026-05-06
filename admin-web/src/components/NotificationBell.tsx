import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Bell, CheckCheck, AlertTriangle, Cpu, Calendar, Coins, Trophy, Info, ListChecks } from "lucide-react";

import { adminWS } from "@/lib/ws";
import { useAuthStore } from "@/stores/auth";
import { useNotificationsStore } from "@/stores/notifications";
import { translateNotification } from "@/lib/notifications-i18n";
import type { NotificationCategory } from "@/lib/types";
import { cn } from "@/lib/cn";

const ICONS: Record<NotificationCategory, React.ComponentType<{ className?: string }>> = {
  SYSTEM: Info,
  ATTENDANCE: Calendar,
  SALARY: Coins,
  KPI: Trophy,
  LEAVE: Calendar,
  DEVICE: Cpu,
  ANOMALY: AlertTriangle,
};

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

export function NotificationBell() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const accessToken = useAuthStore((s) => s.accessToken);
  const items = useNotificationsStore((s) => s.items);
  const unread = useNotificationsStore((s) => s.unread);
  const fetchAll = useNotificationsStore((s) => s.fetch);
  const pushIncoming = useNotificationsStore((s) => s.pushIncoming);
  const markRead = useNotificationsStore((s) => s.markRead);
  const markAllRead = useNotificationsStore((s) => s.markAllRead);

  // Initial load + refresh every 30s as a fallback for missed WS frames.
  useEffect(() => {
    if (!accessToken) return;
    void fetchAll();
    const id = setInterval(() => void fetchAll(), 30_000);
    return () => clearInterval(id);
  }, [accessToken, fetchAll]);

  // WS subscription. Anomaly events from the device webhook flow land on
  // either ``anomaly_detected`` (admin broadcast) or ``notification_new``
  // (per-user). We treat both as new notifications.
  useEffect(() => {
    if (!accessToken) {
      adminWS.disconnect();
      return;
    }
    adminWS.connect(accessToken);
    const offNew = adminWS.on("notification_new", (msg) => {
      pushIncoming(msg as { id?: string; title?: string; body?: string; category?: string });
      void fetchAll();
    });
    const offAnomaly = adminWS.on("anomaly_detected", (msg) => {
      pushIncoming({ ...msg, category: "ANOMALY" } as { title?: string; body?: string; category?: string });
      void fetchAll();
    });
    return () => {
      offNew();
      offAnomaly();
    };
  }, [accessToken, pushIncoming, fetchAll]);

  // Dismiss the dropdown when clicking outside.
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
        className="btn-icon relative text-ink-600"
        aria-label="Notifications"
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <span className="absolute right-1.5 top-1.5 inline-flex min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-tight text-white ring-2 ring-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-x-3 top-16 z-50 mx-auto w-auto max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl border border-[var(--card-border)] bg-white shadow-pop sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-96 sm:max-w-[calc(100vw-2rem)]">
          <div className="flex items-center justify-between border-b border-[var(--card-border)] px-5 py-3.5">
            <span className="text-sm font-semibold text-ink-900">
              {t("notifications.title")} {unread > 0 && <span className="text-ink-500">({unread})</span>}
            </span>
            <button
              onClick={() => void markAllRead()}
              className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline disabled:opacity-50"
              disabled={unread === 0}
            >
              <CheckCheck className="size-3.5" />
              {t("notifications.mark_all_read")}
            </button>
          </div>

          <div className="max-h-[60vh] overflow-y-auto scrollbar-thin">
            {items.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-ink-500">
                {t("notifications.empty")}
              </div>
            ) : (
              items.map((n) => {
                const Icon = ICONS[n.category] ?? Info;
                const tone =
                  n.category === "ANOMALY"
                    ? "text-red-600 bg-red-50"
                    : n.category === "DEVICE"
                      ? "text-amber-600 bg-amber-50"
                      : n.category === "SALARY"
                        ? "text-emerald-600 bg-emerald-50"
                        : "text-brand-600 bg-brand-50";
                return (
                  <button
                    key={n.id}
                    onClick={() => !n.is_read && void markRead(n.id)}
                    className={cn(
                      "flex w-full items-start gap-3 border-b border-[var(--card-border)] px-5 py-3.5 text-left last:border-b-0 hover:bg-ink-50/60",
                      !n.is_read && "bg-brand-50/40"
                    )}
                  >
                    <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", tone)}>
                      <Icon className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className={cn("truncate text-sm text-ink-900", !n.is_read && "font-semibold")}>
                          {translateNotification(t, n.title, n.payload, "title")}
                        </p>
                        <span className="shrink-0 text-xs text-ink-400">{timeAgo(n.created_at)}</span>
                      </div>
                      {(n.body || typeof (n.payload as Record<string, unknown> | null)?.body_key === "string") && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-ink-500">
                          {translateNotification(t, n.body, n.payload, "body")}
                        </p>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Footer: link to the full notifications page */}
          <Link
            to="/app/notifications"
            onClick={() => setOpen(false)}
            className="flex items-center justify-center gap-1.5 border-t border-[var(--card-border)] bg-slate-50 px-5 py-2.5 text-xs font-semibold text-brand-700 hover:bg-slate-100"
          >
            <ListChecks className="size-3.5" />
            {t("notifications.view_all")}
          </Link>
        </div>
      )}
    </div>
  );
}
