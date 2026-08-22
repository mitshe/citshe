import * as React from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

const chipBase =
  "inline-flex items-center gap-1 rounded-md border border-border bg-surface-inset px-2 py-0.5 text-xs font-medium text-muted-foreground";

type ChipProps = {
  children: React.ReactNode;
  className?: string;
  /** When set, the chip becomes a clickable button (e.g. label filter). */
  onClick?: () => void;
  /** Selected/active look — for filter chips that toggle. */
  active?: boolean;
  /** When set, renders a trailing ✕ that calls this on click. */
  onRemove?: () => void;
  /** Accessible label for the remove button. */
  removeLabel?: string;
};

/**
 * Single label/pill primitive. Renders as a span by default, a button when
 * `onClick` is given, and shows a removable ✕ when `onRemove` is given.
 */
function Chip({
  children,
  className,
  onClick,
  active,
  onRemove,
  removeLabel,
}: ChipProps) {
  const interactive = cn(
    chipBase,
    "transition-linear hover:border-border-strong hover:text-foreground",
    active && "border-primary/50 bg-primary/10 text-primary hover:text-primary",
    className,
  );

  const content = (
    <>
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={removeLabel}
          className="rounded-sm p-0.5 transition-linear hover:bg-surface-hover hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      )}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className={cn(
          interactive,
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        {content}
      </button>
    );
  }

  return (
    <span className={cn(chipBase, onRemove && interactive, className)}>
      {content}
    </span>
  );
}

export { Chip };
