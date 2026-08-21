import * as React from "react";

import { cn } from "@/lib/utils";

type StatusDotState =
  | "running"
  | "creating"
  | "paused"
  | "failed"
  | "done"
  | "ok"
  | "warn"
  | "down"
  | "idle";

const STATE_LABELS: Record<StatusDotState, string> = {
  running: "Running",
  creating: "Creating",
  paused: "Paused",
  failed: "Failed",
  done: "Done",
  ok: "OK",
  warn: "Warning",
  down: "Down",
  idle: "Idle",
};

interface StatusDotProps extends React.ComponentProps<"span"> {
  state: StatusDotState;
  /** Size of the dot in px. Defaults to 10 (9 for `creating`). */
  size?: number;
  /**
   * Only meaningful for `running`. When true, renders a pulsing emerald dot
   * (ripple) instead of the default static arc. Used by the open-session
   * header, not by lists.
   */
  pulse?: boolean;
}

function StatusDot({
  state,
  size,
  pulse = false,
  className,
  style,
  ...props
}: StatusDotProps) {
  const label = STATE_LABELS[state];
  const resolvedSize = size ?? (state === "creating" ? 9 : 10);

  return (
    <span
      data-slot="status-dot"
      data-state={state}
      data-pulse={state === "running" && pulse ? "true" : undefined}
      role="status"
      aria-label={label}
      title={label}
      className={cn("status-dot", className)}
      style={{ "--sd-size": `${resolvedSize}px`, ...style } as React.CSSProperties}
      {...props}
    />
  );
}

export { StatusDot };
export type { StatusDotState };
