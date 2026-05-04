import * as React from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/cn";

interface Props {
  label: React.ReactNode;
  value: React.ReactNode;
  /** Percent change vs the previous period. Positive = up, negative = down. */
  delta?: number;
  /** Sub-text rendered below the value (e.g. "vs last month: 1,195"). */
  hint?: React.ReactNode;
  /** Decorative icon shown in the top-right tinted chip. */
  icon?: React.ReactNode;
  /** Tints the icon chip. Defaults to brand. */
  tone?: "brand" | "emerald" | "amber" | "rose" | "sky";
  className?: string;
}

const toneClass: Record<NonNullable<Props["tone"]>, string> = {
  brand: "bg-brand-50 text-brand-600",
  emerald: "bg-emerald-50 text-emerald-600",
  amber: "bg-amber-50 text-amber-600",
  rose: "bg-rose-50 text-rose-600",
  sky: "bg-sky-50 text-sky-600",
};

export function StatCard({ label, value, delta, hint, icon, tone = "brand", className }: Props) {
  const isUp = delta != null && delta >= 0;
  return (
    <div className={cn("card p-5", className)}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</p>
          <div className="mt-2 flex items-end gap-2">
            <p className="text-2xl font-semibold tracking-tight text-ink-900">{value}</p>
            {delta != null && (
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold",
                  isUp
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-rose-50 text-rose-700"
                )}
              >
                {isUp ? (
                  <ArrowUpRight className="size-3" />
                ) : (
                  <ArrowDownRight className="size-3" />
                )}
                {Math.abs(delta).toFixed(2)}%
              </span>
            )}
          </div>
          {hint && <p className="mt-1.5 text-xs text-ink-500">{hint}</p>}
        </div>
        {icon && (
          <span
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-xl",
              toneClass[tone]
            )}
          >
            {icon}
          </span>
        )}
      </div>
    </div>
  );
}
