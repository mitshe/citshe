"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

interface UsageBarProps {
  label: string;
  /** Amount used (same unit as `total`). */
  used: number;
  /** Total / quota. When 0 or missing the bar is hidden by the caller. */
  total: number;
  /** Optional unit shown after the used/total text (e.g. "GB"). */
  unit?: string;
  /** Optional preformatted used/total strings (overrides numeric display). */
  usedLabel?: string;
  totalLabel?: string;
  className?: string;
}

/**
 * A horizontal quota/usage bar: label + used/total text over a thin track. The
 * fill is primary, turns amber above 80% and red above 95%. For right-rail
 * quotas (storage, compute, data transfer, R2).
 */
function UsageBar({
  label,
  used,
  total,
  unit,
  usedLabel,
  totalLabel,
  className,
}: UsageBarProps) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const tone =
    pct > 95 ? "bg-danger" : pct > 80 ? "bg-warn" : "bg-primary";

  const usedText = usedLabel ?? `${trim(used)}${unit ? ` ${unit}` : ""}`;
  const totalText = totalLabel ?? `${trim(total)}${unit ? ` ${unit}` : ""}`;

  return (
    <div className={cn("px-4 py-3", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-xs tabular-nums text-foreground">
          <span className="font-medium">{usedText}</span>
          <span className="text-text-subtle"> / {totalText}</span>
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-hover">
        <div
          className={cn("h-full rounded-full transition-linear", tone)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function trim(v: number): string {
  if (!Number.isFinite(v)) return "0";
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

export { UsageBar };
