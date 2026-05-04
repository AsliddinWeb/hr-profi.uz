import * as React from "react";
import { cn } from "@/lib/cn";

export const Card = ({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("card", className)} {...rest} />
);

export const CardHeader = ({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("card-header", className)} {...rest} />
);

export const CardBody = ({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("card-body", className)} {...rest} />
);

export const CardTitle = ({ className, ...rest }: React.HTMLAttributes<HTMLHeadingElement>) => (
  <h2 className={cn("text-base font-semibold tracking-tight text-ink-900", className)} {...rest} />
);

export const CardSubtitle = ({ className, ...rest }: React.HTMLAttributes<HTMLParagraphElement>) => (
  <p className={cn("text-xs text-ink-500", className)} {...rest} />
);
