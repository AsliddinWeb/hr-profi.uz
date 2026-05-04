"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

interface ServerTime {
  iso: string;
  tz: string;
  local: string;
  offset_minutes: number;
}

let cached: { fetchedAt: number; serverEpoch: number; offset: number } | null = null;

/**
 * Live wall clock that ticks against the server's clock, not the
 * browser's. Useful for the Bugun screen so an employee with a wrong
 * device clock still sees the time the API will use when stamping their
 * check-in. Re-fetches the offset every 5 minutes to correct drift.
 */
export function SystemClock({ className = "" }: { className?: string }) {
  const [info, setInfo] = useState<ServerTime | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const fetchTime = async () => {
      try {
        const r = await fetch("/api/v1/server-time", {
          headers: { Accept: "application/json" },
        });
        if (r.ok) {
          const data = (await r.json()) as ServerTime;
          if (!cancelled) setInfo(data);
        }
      } catch {
        // Network blip — cached info keeps ticking.
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

  return (
    <span
      className={`inline-flex items-center gap-1 font-mono text-xs tabular-nums text-slate-600 ${className}`}
      title={info ? `${info.tz}` : "Loading server time"}
    >
      <Clock className="size-3.5 text-brand-600" />
      {formatNow(info)}
    </span>
  );
}

function formatNow(info: ServerTime | null): string {
  if (!info) return "—";
  if (!cached || cached.serverEpoch !== Date.parse(info.iso)) {
    cached = {
      fetchedAt: Date.now(),
      serverEpoch: Date.parse(info.iso),
      offset: info.offset_minutes,
    };
  }
  const elapsed = Date.now() - cached.fetchedAt;
  const serverNowMs = cached.serverEpoch + elapsed;
  const d = new Date(serverNowMs + cached.offset * 60_000);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}
