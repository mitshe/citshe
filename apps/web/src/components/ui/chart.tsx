"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { cn } from "@/lib/utils";

interface ChartProps {
  /** The series, oldest→newest. */
  data: number[];
  /** 'area' = filled line (our 'line'), 'bar' = thin bars. */
  kind: "area" | "bar";
  /** Optional value label (used in the tooltip). */
  label?: string;
  /** Optional unit suffix for the tooltip value. */
  unit?: string;
  /** Optional per-point X-axis labels (same length as data). */
  xLabels?: string[];
  /** Stroke / bar color. Defaults to the DS primary blue. */
  color?: string;
  className?: string;
  /** Chart body height in px. */
  height?: number;
}

// DS primary blue (oklch(0.62 0.17 250)) with a safe hex fallback for the
// SVG paint (recharts needs a resolvable color at render time).
const PRIMARY = "var(--primary, #3d7dff)";
const BORDER = "var(--border, rgba(255,255,255,0.08))";
const MUTED = "var(--muted-foreground, #8b8b96)";

/** Compact number formatting for axis ticks & tooltip: 1200 → 1.2k, 45000 → 45k. */
function formatCompact(v: number): string {
  if (!Number.isFinite(v)) return "";
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000)
    return `${trim(v / 1_000_000_000)}b`;
  if (abs >= 1_000_000) return `${trim(v / 1_000_000)}m`;
  if (abs >= 1_000) return `${trim(v / 1_000)}k`;
  return trim(v);
}

function trim(v: number): string {
  // At most one decimal place, no trailing ".0".
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

type Point = { i: number; v: number; x: string };

function CustomTooltip({
  active,
  payload,
  label,
  unit,
  showTime,
}: {
  active?: boolean;
  payload?: Array<{ payload: Point }>;
  label?: string;
  unit?: string;
  showTime?: boolean;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  const value = `${formatCompact(p.v)}${unit ? ` ${unit}` : ""}`;
  return (
    <div className="rounded-md border border-border bg-surface-card px-2.5 py-1.5 text-xs shadow-md">
      {label && (
        <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wider text-text-subtle">
          {label}
        </div>
      )}
      <div className="font-medium tabular-nums text-foreground">{value}</div>
      {showTime && p.x && (
        <div className="mt-0.5 text-[10px] text-text-subtle">{p.x}</div>
      )}
    </div>
  );
}

/**
 * A full chart card body (NOT a sparkline) built on recharts — axes, gridlines,
 * filled area / bars, and a dark DS-styled hover tooltip. Modeled on the Neon /
 * Cloudflare / Vercel monitoring dashboards. Client component (recharts).
 *
 * Renders an empty muted state for <2 points.
 */
function Chart({
  data,
  kind,
  label,
  unit,
  xLabels,
  color = PRIMARY,
  className,
  height = 200,
}: ChartProps) {
  const clean = React.useMemo(
    () => (Array.isArray(data) ? data.filter((v) => Number.isFinite(v)) : []),
    [data],
  );

  const points: Point[] = React.useMemo(() => {
    const n = clean.length;
    return clean.map((v, i) => ({
      i,
      v,
      x: xLabels?.[i] ?? (i === 0 ? "start" : i === n - 1 ? "now" : String(i)),
    }));
  }, [clean, xLabels]);

  const gradientId = React.useId().replace(/:/g, "");

  if (clean.length < 2) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-md border border-dashed border-border text-xs text-text-subtle",
          className,
        )}
        style={{ height }}
      >
        Not enough data yet
      </div>
    );
  }

  // Show only first / middle / last X ticks to avoid clutter.
  const n = points.length;
  const midIdx = Math.floor((n - 1) / 2);
  const tickIndices = new Set([0, midIdx, n - 1]);
  const xTickFormatter = (_: unknown, index: number) =>
    tickIndices.has(index) ? points[index]?.x ?? "" : "";

  const showTime = !!xLabels;

  const axisTick = { fill: MUTED, fontSize: 10 };

  return (
    <div className={cn("w-full", className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {kind === "bar" ? (
          <BarChart
            data={points}
            margin={{ top: 8, right: 8, bottom: 4, left: 0 }}
          >
            <CartesianGrid
              vertical={false}
              stroke={BORDER}
              strokeDasharray="3 3"
            />
            <XAxis
              dataKey="x"
              tick={axisTick}
              tickFormatter={xTickFormatter}
              interval={0}
              axisLine={false}
              tickLine={false}
              minTickGap={0}
              height={20}
            />
            <YAxis
              width={36}
              tick={axisTick}
              tickCount={4}
              tickFormatter={(v) => formatCompact(Number(v))}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              cursor={{ fill: "var(--surface-hover, rgba(255,255,255,0.04))" }}
              content={
                <CustomTooltip label={label} unit={unit} showTime={showTime} />
              }
            />
            <Bar
              dataKey="v"
              fill={color}
              radius={[2, 2, 0, 0]}
              maxBarSize={22}
            />
          </BarChart>
        ) : (
          <AreaChart
            data={points}
            margin={{ top: 8, right: 8, bottom: 4, left: 0 }}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.28} />
                <stop offset="100%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid
              vertical={false}
              stroke={BORDER}
              strokeDasharray="3 3"
            />
            <XAxis
              dataKey="x"
              tick={axisTick}
              tickFormatter={xTickFormatter}
              interval={0}
              axisLine={false}
              tickLine={false}
              minTickGap={0}
              height={20}
            />
            <YAxis
              width={36}
              tick={axisTick}
              tickCount={4}
              tickFormatter={(v) => formatCompact(Number(v))}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              cursor={{ stroke: BORDER, strokeWidth: 1 }}
              content={
                <CustomTooltip label={label} unit={unit} showTime={showTime} />
              }
            />
            <Area
              type="monotone"
              dataKey="v"
              stroke={color}
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              dot={false}
              activeDot={{ r: 3, fill: color, strokeWidth: 0 }}
            />
          </AreaChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

export { Chart };
