import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Eyebrow — the canonical small uppercase section label.
 * Used on its own or as the `label` of a `SectionHeader`.
 */
function Eyebrow({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="eyebrow"
      className={cn(
        "text-[13px] font-medium uppercase tracking-wide text-text-subtle",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Count badge — a single canonical style for the "N" pill next to a label.
 */
function SectionCount({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="section-count"
      className={cn(
        "rounded-md bg-surface-hover px-1.5 text-[11px] tabular-nums text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

interface SectionHeaderProps
  extends Omit<React.ComponentProps<"div">, "children"> {
  /** Section label (rendered as an uppercase eyebrow). */
  label: React.ReactNode;
  /** Optional count shown as a small badge next to the label. */
  count?: number;
  /** Optional leading icon before the label. */
  icon?: React.ReactNode;
  /** Right-side action link target. When set, renders a link with an arrow. */
  actionHref?: string;
  /** Label for the action link. */
  actionLabel?: React.ReactNode;
  /** Arbitrary right-side action node (e.g. a button). Overrides the link. */
  action?: React.ReactNode;
}

/**
 * SectionHeader — the canonical header for a content section.
 *
 * <SectionHeader label="Repos" count={3} actionHref="/repos" actionLabel="All" />
 * <SectionHeader label="Servers" count={2} action={<Button>Add</Button>} />
 */
function SectionHeader({
  label,
  count,
  icon,
  actionHref,
  actionLabel = "All",
  action,
  className,
  ...props
}: SectionHeaderProps) {
  const rightSide =
    action ??
    (actionHref ? (
      <Link
        href={actionHref}
        className="flex items-center gap-1 text-xs text-muted-foreground transition-linear hover:text-foreground"
      >
        {actionLabel}
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    ) : null);

  return (
    <div
      data-slot="section-header"
      className={cn("flex items-center justify-between gap-2", className)}
      {...props}
    >
      <div className="flex items-center gap-1.5">
        {icon && <span className="text-text-subtle">{icon}</span>}
        <Eyebrow>{label}</Eyebrow>
        {count != null && count > 0 && (
          <SectionCount className="normal-case tracking-normal">
            {count}
          </SectionCount>
        )}
      </div>
      {rightSide}
    </div>
  );
}

export { SectionHeader, Eyebrow, SectionCount };
