import * as React from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";
import { cn } from "@/lib/cn";

interface Crumb {
  label: string;
  to?: string;
}

interface Props {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Breadcrumb trail. ``Home`` is prepended automatically. */
  breadcrumbs?: Crumb[];
  /** Right-aligned slot for actions (Create button, etc.). */
  actions?: React.ReactNode;
  /** Optional left adornment, e.g. a colored icon chip. */
  icon?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, description, breadcrumbs, actions, icon, className }: Props) {
  return (
    <div className={cn("space-y-3", className)}>
      {(breadcrumbs && breadcrumbs.length > 0) && (
        <nav className="flex items-center gap-1.5 text-xs text-ink-500">
          <Link to="/" className="inline-flex items-center gap-1 hover:text-ink-700">
            <Home className="size-3.5" />
          </Link>
          {breadcrumbs.map((c, idx) => (
            <React.Fragment key={idx}>
              <ChevronRight className="size-3 text-ink-400" />
              {c.to && idx < breadcrumbs.length - 1 ? (
                <Link to={c.to} className="hover:text-ink-700">
                  {c.label}
                </Link>
              ) : (
                <span className="font-medium text-ink-700">{c.label}</span>
              )}
            </React.Fragment>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          {icon && (
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              {icon}
            </span>
          )}
          <div>
            <h1 className="page-title">{title}</h1>
            {description && <p className="page-description">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
