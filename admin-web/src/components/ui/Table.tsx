import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Table primitives. We use the shared `.data-table` rule from globals.css for
 * the base look (head bg, row border, hover, cell padding) so individual
 * pages don't repeat utility classes. Pages can still pass `className` to
 * override on a per-table basis.
 */
export const Table = ({ className, ...rest }: React.HTMLAttributes<HTMLTableElement>) => (
  <div className="overflow-x-auto rounded-2xl border border-[var(--card-border)] bg-white shadow-card">
    <table className={cn("data-table", className)} {...rest} />
  </div>
);

export const THead = (props: React.HTMLAttributes<HTMLTableSectionElement>) => <thead {...props} />;

export const TBody = (props: React.HTMLAttributes<HTMLTableSectionElement>) => <tbody {...props} />;

export const TR = (props: React.HTMLAttributes<HTMLTableRowElement>) => <tr {...props} />;

export const TH = (props: React.ThHTMLAttributes<HTMLTableCellElement>) => <th {...props} />;

export const TD = (props: React.TdHTMLAttributes<HTMLTableCellElement>) => <td {...props} />;
