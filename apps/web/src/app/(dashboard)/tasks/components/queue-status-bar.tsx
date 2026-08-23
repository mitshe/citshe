"use client";

import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { StatusDot } from "@/components/ui/status-dot";
import { useQueueOverview, useSetAutoPull } from "@/lib/api/hooks";

/**
 * Slim status bar above the board: the per-portal Auto-pull switch plus a
 * compact "N running / M workers · K queued" readout. When Auto-pull is on,
 * idle workers pull QUEUED tasks (lowest queueOrder first); when off they wait.
 */
export function QueueStatusBar({ className }: { className?: string }) {
  const { data: overview } = useQueueOverview();
  const setAutoPull = useSetAutoPull();

  const autoPull = overview?.autoPull ?? false;
  const running = overview?.runningWorkers ?? 0;
  const maxWorkers = overview?.maxWorkers ?? 0;
  const queued = overview?.queued.length ?? 0;

  const onToggle = async (next: boolean) => {
    try {
      await setAutoPull.mutateAsync(next);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update auto-pull",
      );
    }
  };

  // A quiet single-line strip — no card/box — so it reads as a status line
  // above the board rather than a heavy panel interrupting it.
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1.5 px-1 text-xs",
        className,
      )}
    >
      <label className="flex select-none items-center gap-2">
        <Switch
          checked={autoPull}
          onCheckedChange={onToggle}
          disabled={!overview || setAutoPull.isPending}
          aria-label="Auto-run queued tasks"
        />
        <span className="font-medium text-foreground">Auto-run queued</span>
        <span
          className={cn(
            "text-[10px] font-semibold uppercase",
            autoPull ? "text-ok" : "text-text-subtle",
          )}
        >
          {autoPull ? "On" : "Off"}
        </span>
      </label>

      <div className="ml-auto flex items-center gap-2.5 tabular-nums text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <StatusDot state={running > 0 ? "running" : "idle"} size={8} />
          {running} of {maxWorkers} running
        </span>
        <span className="text-text-subtle/50">·</span>
        <span>{queued} waiting</span>
      </div>
    </div>
  );
}
