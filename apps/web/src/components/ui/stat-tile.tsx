"use client";

import * as React from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { StatusDot } from "@/components/ui/status-dot";
import type { HealthState } from "@citshe/types";

const valueTint: Record<HealthState, string> = {
  ok: "text-ok",
  warn: "text-warn",
  down: "text-danger",
  idle: "text-foreground",
};

/** A tiny inline sparkline (no axes, ~40px) drawn as a minimal SVG path. */
function Sparkline({
  data,
  className,
}: {
  data: number[];
  className?: string;
}) {
  const id = React.useId().replace(/:/g, "");
  const clean = data.filter((v) => Number.isFinite(v));
  if (clean.length < 2) return null;

  const w = 72;
  const h = 24;
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const span = max - min || 1;
  const step = w / (clean.length - 1);
  const points = clean.map((v, i) => {
    const x = i * step;
    const y = h - ((v - min) / span) * h;
    return [x, y] as const;
  });
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `0,${h} ${line} ${w},${h}`;

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={cn("overflow-visible", className)}
      aria-hidden
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop
            offset="0%"
            stopColor="var(--primary, #3d7dff)"
            stopOpacity={0.22}
          />
          <stop
            offset="100%"
            stopColor="var(--primary, #3d7dff)"
            stopOpacity={0}
          />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${id})`} />
      <polyline
        points={line}
        fill="none"
        stroke="var(--primary, #3d7dff)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

interface StatTileProps {
  label: string;
  value: string;
  delta?: string;
  deltaGood?: boolean;
  unit?: string;
  sparkline?: number[];
  state?: HealthState;
  className?: string;
}

/**
 * The Vercel-style "big number" tile: uppercase muted label, large tabular
 * value, optional delta (green ↑ when good, red ↓ else) and an optional tiny
 * inline sparkline. Bordered, rounded card.
 */
function StatTile({
  label,
  value,
  delta,
  deltaGood,
  unit,
  sparkline,
  state,
  className,
}: StatTileProps) {
  const good = deltaGood !== false;
  const hasSpark = Array.isArray(sparkline) && sparkline.length >= 2;

  return (
    <div
      className={cn(
        "flex flex-col justify-between gap-3 rounded-lg border border-border bg-surface-card p-4",
        className,
      )}
    >
      <div className="flex items-center gap-1.5">
        {state && state !== "idle" && <StatusDot state={state} size={6} />}
        <span className="truncate text-[11px] font-medium uppercase tracking-wider text-text-subtle">
          {label}
        </span>
      </div>

      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-baseline gap-1.5">
            <span
              className={cn(
                "text-2xl font-semibold tabular-nums leading-none",
                state ? valueTint[state] : "text-foreground",
              )}
            >
              {value}
            </span>
            {unit && (
              <span className="text-sm text-text-subtle">{unit}</span>
            )}
          </div>
          {delta && (
            <span
              className={cn(
                "mt-1.5 inline-flex items-center gap-0.5 text-xs font-medium tabular-nums",
                good ? "text-ok" : "text-danger",
              )}
            >
              {good ? (
                <ArrowUpRight className="h-3 w-3" />
              ) : (
                <ArrowDownRight className="h-3 w-3" />
              )}
              {delta}
            </span>
          )}
        </div>

        {hasSpark && <Sparkline data={sparkline!} className="shrink-0" />}
      </div>
    </div>
  );
}

export { StatTile, Sparkline };
