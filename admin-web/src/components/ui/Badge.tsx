import * as React from "react";
import { cn } from "@/lib/cn";

type Tone = "default" | "success" | "warning" | "danger" | "info";

const toneClass: Record<Tone, string> = {
  default: "pill-neutral",
  success: "pill-success",
  warning: "pill-warning",
  danger: "pill-danger",
  info: "pill-info",
};

interface Props extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  /** Adds a small leading dot — useful for status indicators. */
  dot?: boolean;
}

export const Badge = ({ tone = "default", dot, className, children, ...rest }: Props) => (
  <span className={cn("pill", toneClass[tone], className)} {...rest}>
    {dot && (
      <span
        className={cn(
          "size-1.5 rounded-full",
          tone === "success" && "bg-emerald-500",
          tone === "warning" && "bg-amber-500",
          tone === "danger" && "bg-red-500",
          tone === "info" && "bg-brand-500",
          tone === "default" && "bg-ink-400"
        )}
      />
    )}
    {children}
  </span>
);
