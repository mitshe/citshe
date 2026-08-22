"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { StatusDot } from "@/components/ui/status-dot";
import type { HealthState } from "@citshe/types";

const tint: Record<HealthState, string> = {
  ok: "text-ok bg-ok/10 border-ok/20",
  warn: "text-warn bg-warn/10 border-warn/20",
  down: "text-danger bg-danger/10 border-danger/20",
  idle: "text-muted-foreground bg-surface-hover border-border",
};

/** Default human words per state (Operational / Degraded / Down / Unknown). */
const DEFAULT_LABEL: Record<HealthState, string> = {
  ok: "Operational",
  warn: "Degraded",
  down: "Down",
  idle: "Unknown",
};

interface StatusPillProps {
  state: HealthState;
  /** Override the word; defaults to Operational/Degraded/Down/Unknown. */
  label?: string;
  className?: string;
}

/**
 * A pill (dot + word) for a plugin's overall health. Colored by state, reuses
 * StatusDot. Used in the Overview status strip.
 */
function StatusPill({ state, label, className }: StatusPillProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        tint[state],
        className,
      )}
    >
      <StatusDot state={state} size={7} />
      {label ?? DEFAULT_LABEL[state]}
    </span>
  );
}

export { StatusPill };
