import { cn } from "@/lib/utils";

interface WizardProgressProps {
  /** 1-based current step. */
  current: number;
  total: number;
  className?: string;
}

/**
 * Thin top-of-wizard progress: a "2 / 5" counter above a filling blue bar.
 * Deliberately minimal (no numbered circles) so it reads the same on a phone
 * and on desktop.
 */
export function WizardProgress({
  current,
  total,
  className,
}: WizardProgressProps) {
  const pct = Math.round((current / total) * 100);
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center justify-between text-xs font-medium text-text-subtle">
        <span>
          Step {current} of {total}
        </span>
        <span>{pct}%</span>
      </div>
      <div className="h-0.5 w-full overflow-hidden rounded-full bg-border">
        <div
          className="h-full rounded-full bg-primary transition-linear"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
