import * as React from "react";
import { cn } from "@/lib/utils";

interface RadioCardProps {
  /** Selected state. */
  selected: boolean;
  onSelect: () => void;
  /** Leading icon (neutral by default, accented when selected). */
  icon?: React.ReactNode;
  title: string;
  description?: string;
  /** Optional footer line (e.g. "With a guide →"). */
  hint?: string;
  className?: string;
  disabled?: boolean;
}

/**
 * A large, tappable single-choice card (radio). Used across the New-project
 * wizard for "what are we doing?" style forks. Selected = blue border + subtle
 * glow; neutral icon turns accent. Big touch target for mobile.
 */
export function RadioCard({
  selected,
  onSelect,
  icon,
  title,
  description,
  hint,
  className,
  disabled,
}: RadioCardProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "group flex w-full flex-col items-start gap-2 rounded-lg border border-border bg-surface-card p-4 text-left transition-linear",
        "hover:border-border-strong hover:bg-surface-hover",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
        selected &&
          "border-primary bg-primary/[0.06] shadow-[0_0_0_1px_var(--color-primary),0_8px_30px_-12px_var(--color-primary)] hover:border-primary",
        className,
      )}
    >
      {icon && (
        <span
          className={cn(
            "flex size-9 items-center justify-center rounded-md border border-border bg-surface-inset text-muted-foreground transition-linear",
            selected && "border-primary/40 bg-primary/10 text-primary",
          )}
        >
          {icon}
        </span>
      )}
      <span className="text-[15px] font-semibold tracking-tight text-foreground">
        {title}
      </span>
      {description && (
        <span className="text-sm text-muted-foreground">{description}</span>
      )}
      {hint && (
        <span
          className={cn(
            "mt-1 text-xs font-medium text-text-subtle transition-linear",
            selected && "text-primary",
          )}
        >
          {hint}
        </span>
      )}
    </button>
  );
}
