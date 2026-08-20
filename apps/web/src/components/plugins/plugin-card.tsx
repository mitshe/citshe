"use client";

import { ExternalLink, Loader2, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePluginStatus, useRunPluginAction } from "@/lib/api/hooks";
import { getPluginDef } from "@/lib/plugin-catalog";
import { toast } from "sonner";
import type { HealthState, PluginType, PluginAction } from "@/lib/api/types";

const dotColor: Record<HealthState, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  down: "bg-red-500",
  idle: "bg-muted-foreground/50",
};

const textColor: Record<HealthState, string> = {
  ok: "text-emerald-500",
  warn: "text-amber-500",
  down: "text-red-500",
  idle: "text-muted-foreground",
};

/**
 * A connected plugin's live status, rendered from the normalized PluginStatus.
 * Same card on the Home dashboard and the /plugins page.
 */
export function PluginCard({ type }: { type: PluginType }) {
  const def = getPluginDef(type);
  const { data: status, isLoading } = usePluginStatus(type);

  if (!def) return null;

  const state: HealthState = status?.headline.state ?? "idle";

  return (
    <div className="rounded-xl border border-border bg-background/50 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={def.accent}>{def.icon}</span>
          <span className="font-medium">{def.name}</span>
        </div>
        {isLoading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        ) : (
          <span className={cn("flex items-center gap-1.5 text-xs font-medium", textColor[state])}>
            <span className={cn("h-1.5 w-1.5 rounded-full", dotColor[state])} />
            {status?.headline.label ?? "—"}
          </span>
        )}
      </div>

      {status?.error ? (
        <p className="mt-3 text-xs text-red-500">{status.error}</p>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
          {(status?.metrics ?? []).map((m, i) => (
            <div key={i} className="min-w-0">
              <p className="truncate text-[11px] uppercase tracking-wider text-muted-foreground/70">
                {m.label}
              </p>
              <p className={cn("truncate text-sm font-medium", m.state && textColor[m.state])}>
                {m.value}
              </p>
              {m.hint && (
                <p className="truncate text-[11px] text-muted-foreground">
                  {m.hint}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {status?.items && status.items.length > 0 && (
        <div className="mt-3 space-y-1 border-t border-border/60 pt-2.5">
          {status.items.map((it, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-2 text-xs"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    it.state ? dotColor[it.state] : "bg-muted-foreground/40",
                  )}
                />
                <span className="truncate text-muted-foreground">
                  {it.label}
                </span>
              </span>
              <span className="shrink-0 text-muted-foreground/70">
                {it.value}
              </span>
            </div>
          ))}
        </div>
      )}

      {status?.links && status.links.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-3 border-t border-border/60 pt-2.5">
          {status.links.map((l, i) => (
            <a
              key={i}
              href={l.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="h-3 w-3" />
              {l.label}
            </a>
          ))}
        </div>
      )}

      {status?.actions && status.actions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-border/60 pt-2.5">
          {status.actions.map((a) => (
            <ActionButton key={a.id} type={type} action={a} />
          ))}
        </div>
      )}
    </div>
  );
}

function ActionButton({
  type,
  action,
}: {
  type: PluginType;
  action: PluginAction;
}) {
  const run = useRunPluginAction(type);

  const onClick = async () => {
    let input: Record<string, unknown> | undefined;
    if (action.prompt) {
      const value = window.prompt(action.prompt);
      if (value === null || !value.trim()) return;
      input = { value: value.trim() };
    } else if (
      action.confirm &&
      !window.confirm(`${action.label}${action.target ? ` — ${action.target}` : ""}?`)
    ) {
      return;
    }
    try {
      const res = await run.mutateAsync({ actionId: action.id, input });
      if (res.ok) toast.success(res.message);
      else toast.error(res.message);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    }
  };

  return (
    <button
      onClick={onClick}
      disabled={run.isPending}
      className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
    >
      {run.isPending ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Zap className="h-3 w-3" />
      )}
      {action.label}
    </button>
  );
}
