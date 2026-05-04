import * as React from "react";
import { cn } from "@/lib/cn";

interface Props extends React.HTMLAttributes<HTMLSpanElement> {
  name?: string | null;
  src?: string | null;
  size?: "xs" | "sm" | "md" | "lg";
}

const sizeClass: Record<NonNullable<Props["size"]>, string> = {
  xs: "size-6 text-[10px]",
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-12 text-base",
};

function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join("") || "?";
}

export const Avatar = ({ name, src, size = "md", className, ...rest }: Props) => (
  <span
    className={cn(
      "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-100 font-semibold text-brand-700",
      sizeClass[size],
      className
    )}
    {...rest}
  >
    {src ? (
      <img src={src} alt={name ?? ""} className="size-full object-cover" />
    ) : (
      <span>{initials(name)}</span>
    )}
  </span>
);
