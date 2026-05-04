import * as React from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "danger" | "success" | "ghost";
type Size = "sm" | "md";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  /** Renders as a square 36×36 icon button — no horizontal padding for label. */
  iconOnly?: boolean;
}

const variantClass: Record<Variant, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  danger: "btn-danger",
  success: "btn-success",
  ghost: "btn-ghost",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { variant = "primary", size = "md", loading, disabled, iconOnly, className, children, ...rest },
    ref
  ) => (
    <button
      ref={ref}
      className={cn(
        variantClass[variant],
        size === "sm" && "btn-sm",
        iconOnly && "!size-9 !p-0",
        className
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && (
        <span className="inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {children}
    </button>
  )
);
Button.displayName = "Button";
