import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

import { cn } from "@/lib/cn";

interface ServerTime {
  iso: string;
  tz: string;
  local: string;
  offset_minutes: number;
}

/**
 * Live server clock for dashboards. The current implementation:
 *
 * - Fetches ``/health/server-time`` once on mount to learn the server's
 *   timezone + offset between server and browser clocks (so we don't
 *   drift if a workstation has the wrong system time).
 * - Re-fetches every 5 minutes to correct accumulated drift.
 * - Ticks the visible clock every second using the cached offset.
 *
 * Why not just ``new Date()``? In practice users have wrong system clocks
 * surprisingly often, especially in shared workstations. Showing the
 * SERVER's time (which is what attendance is actually written against)
 * is the accurate signal.
 */
export function SystemClock({ className }: { className?: string }) {
  const [info, setInfo] = useState<ServerTime | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const fetchTime = async () => {
      try {
        // The server-time endpoint sits outside ``/api/v1``; use the
        // bare relative path so the nginx proxy still routes it to the
        // backend service.
        const r = await fetch("/api/v1/server-time", {
          headers: { Accept: "application/json" },
        });
        if (r.ok) {
          const data = (await r.json()) as ServerTime;
          if (!cancelled) setInfo(data);
        }
      } catch {
        // Network blip — the cached info keeps ticking.
      }
    };
    void fetchTime();
    const refresh = window.setInterval(fetchTime, 5 * 60_000);
    const ticker = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(refresh);
      window.clearInterval(ticker);
    };
  }, []);

  // Compute the "now" we display: server's UTC ISO + (Date.now() - cached
  // server-fetch instant) shifted by the server's offset.
  const display = formatNow(info);
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-[var(--card-border)] bg-white/60 px-2.5 py-1 font-mono text-[11px] font-semibold tabular-nums text-ink-700 backdrop-blur",
        className
      )}
      title={info ? `${info.tz} (server time)` : "Loading server time"}
    >
      <Clock className="size-3 text-brand-600" />
      <span>{display}</span>
    </div>
  );
}

let cached: { fetchedAt: number; serverEpoch: number; offset: number } | null = null;

function formatNow(info: ServerTime | null): string {
  if (!info) return "—";
  // Re-cache when the server-time response shape changes.
  if (!cached || cached.serverEpoch !== Date.parse(info.iso)) {
    cached = {
      fetchedAt: Date.now(),
      serverEpoch: Date.parse(info.iso),
      offset: info.offset_minutes,
    };
  }
  const elapsed = Date.now() - cached.fetchedAt;
  const serverNowMs = cached.serverEpoch + elapsed;
  // Render in the server's local zone using the offset.
  const d = new Date(serverNowMs + cached.offset * 60_000);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}
