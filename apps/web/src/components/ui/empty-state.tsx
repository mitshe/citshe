import * as React from "react";

import { cn } from "@/lib/utils";

interface EmptyStateProps
  extends Omit<React.ComponentProps<"div">, "title"> {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  /**
   * "left" (default) — a compact, left-aligned panel that doesn't sprawl into a
   * giant centered island. "center" — the old centered treatment, only for
   * small empty cells inside a column.
   */
  align?: "left" | "center";
}

function EmptyState({
  icon,
  title,
  description,
  action,
  align = "left",
  className,
  ...props
}: EmptyStateProps) {
  const centered = align === "center";
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-dashed border-border bg-surface-inset/40 px-6 py-8",
        centered
          ? "items-center justify-center py-12 text-center"
          : "items-start text-left",
        className,
      )}
      {...props}
    >
      {icon && (
        <div className="flex size-10 items-center justify-center rounded-full bg-surface-hover text-muted-foreground [&_svg]:size-5">
          {icon}
        </div>
      )}
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description && (
          <p
            className={cn(
              "max-w-sm text-sm text-muted-foreground",
              centered && "mx-auto",
            )}
          >
            {description}
          </p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export { EmptyState };
