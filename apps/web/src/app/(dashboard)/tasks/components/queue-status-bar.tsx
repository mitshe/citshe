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

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-surface-inset px-3 py-2",
        className,
      )}
    >
      <label className="flex select-none items-center gap-2.5">
        <Switch
          checked={autoPull}
          onCheckedChange={onToggle}
          disabled={!overview || setAutoPull.isPending}
          aria-label="Auto-pull queued tasks"
        />
        <span className="flex flex-col leading-tight">
          <span className="text-xs font-medium text-foreground">
            Auto-run queued tasks
            <span
              className={cn(
                "ml-1.5 text-[10px] font-semibold uppercase",
                autoPull ? "text-ok" : "text-text-subtle",
              )}
            >
              {autoPull ? "On" : "Off"}
            </span>
          </span>
          <span className="text-[11px] text-muted-foreground">
            {autoPull
              ? "AI picks up queued tasks and runs them for you"
              : "Queued tasks wait here until you turn this on"}
          </span>
        </span>
      </label>

      <div className="ml-auto flex items-center gap-3 text-[11px] tabular-nums text-muted-foreground">
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
