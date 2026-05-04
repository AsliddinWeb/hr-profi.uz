import * as React from "react";
import { cn } from "@/lib/cn";

/** ``prefix``/``suffix`` clash with native HTMLInputElement attributes, so we
 * omit them from the underlying interface and re-introduce them as our slot
 * props. */
interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "prefix" | "suffix"> {
  label?: string;
  error?: string;
  hint?: string;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, prefix, suffix, id, className, ...rest }, ref) => {
    const generatedId = React.useId();
    const inputId = id ?? generatedId;

    const fieldClass = cn(
      "input",
      prefix && "pl-9",
      suffix && "pr-9",
      error && "ring-red-300 focus:ring-red-500",
      className
    );

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="label">
            {label}
          </label>
        )}
        <div className="relative">
          {prefix && (
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-400">
              {prefix}
            </span>
          )}
          <input ref={ref} id={inputId} className={fieldClass} {...rest} />
          {suffix && (
            <span className="absolute inset-y-0 right-3 flex items-center text-ink-400">
              {suffix}
            </span>
          )}
        </div>
        {(error || hint) && (
          <p className={cn("mt-1.5 text-xs", error ? "text-red-600" : "text-ink-500")}>
            {error ?? hint}
          </p>
        )}
      </div>
    );
  }
);
Input.displayName = "Input";
