"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { cn } from "@/lib/utils";

/** A named series for a multi-series chart (status split, requests+errors…). */
export interface ChartSeries {
  label: string;
  values: number[];
  color?: string;
}

interface ChartProps {
  /** The single series, oldest→newest. Ignored when `series` is set. */
  data?: number[];
  /**
   * Multiple named series sharing one X axis. When present this drives the
   * chart (stacked area for `kind='area'`, multi-line for `kind='line'`).
   */
  series?: ChartSeries[];
  /**
   * Chart language:
   * - `area` = filled line + subtle gradient (continuous traffic). DEFAULT.
   * - `line` = plain line, no fill (rates: error%, cache%, load).
   * - `bar`  = discrete counts (deploys/day, ops/hour).
   */
  kind: "area" | "line" | "bar";
  /** Optional value label (used in the single-series tooltip title). */
  label?: string;
  /** Optional unit suffix for the tooltip value. */
  unit?: string;
  /** Optional per-point X-axis labels (same length as data). */
  xLabels?: string[];
  /** Stroke / bar / area color. Defaults to the DS primary blue. */
  color?: string;
  className?: string;
  /** Chart body height in px. */
  height?: number;
  /** When true, render the loading skeleton in the chart footprint. */
  loading?: boolean;
  /** Empty-state title (shown when there's no data). */
  emptyTitle?: string;
  /** Empty-state hint under the title. */
  emptyHint?: string;
}

// DS colors — resolvable at SVG paint time (recharts needs a real color).
const PRIMARY = "var(--primary, #3d7dff)";
const BORDER = "var(--border, rgba(255,255,255,0.08))";
const MUTED = "var(--muted-foreground, #8b8b96)";

// Small semantic palette for named series (HTTP status split etc.). Keyed by a
// normalized series label so 2xx→emerald, 3xx→blue, 4xx→amber, 5xx→red.
const OK = "var(--ok, #34d399)";
const INFO = "var(--info, #60a5fa)";
const WARN = "var(--warn, #f59e0b)";
const DANGER = "var(--danger, #ef4444)";

function paletteFor(label: string, fallbackIndex: number): string {
  const l = label.toLowerCase();
  if (l.startsWith("2") || l.includes("ok") || l.includes("success")) return OK;
  if (l.startsWith("3") || l.includes("redirect")) return INFO;
  if (l.startsWith("4") || l.includes("client")) return WARN;
  if (l.startsWith("5") || l.includes("error") || l.includes("server"))
    return DANGER;
  const cycle = [PRIMARY, OK, INFO, WARN, DANGER];
  return cycle[fallbackIndex % cycle.length];
}

/** Compact number formatting for axis ticks & tooltip: 1200 → 1.2k. */
function formatCompact(v: number): string {
  if (!Number.isFinite(v)) return "";
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `${trim(v / 1_000_000_000)}b`;
  if (abs >= 1_000_000) return `${trim(v / 1_000_000)}m`;
  if (abs >= 1_000) return `${trim(v / 1_000)}k`;
  return trim(v);
}

function trim(v: number): string {
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

type Point = { i: number; x: string } & Record<string, number | string>;

interface SeriesMeta {
  key: string;
  label: string;
  color: string;
}

function CustomTooltip({
  active,
  payload,
  unit,
  seriesMeta,
  singleLabel,
  showTime,
}: {
  active?: boolean;
  payload?: Array<{ payload: Point }>;
  unit?: string;
  seriesMeta: SeriesMeta[];
  singleLabel?: string;
  showTime?: boolean;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  const multi = seriesMeta.length > 1;

  return (
    <div className="rounded-md border border-border bg-surface-card px-2.5 py-1.5 text-xs shadow-md">
      {/* Timestamp / X label header (unified crosshair). */}
      {(showTime || multi) && p.x && (
        <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-text-subtle">
          {p.x}
        </div>
      )}
      {!multi && singleLabel && !showTime && (
        <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wider text-text-subtle">
          {singleLabel}
        </div>
      )}
      <div className="space-y-0.5">
        {seriesMeta.map((s) => {
          const raw = p[s.key];
          const num = typeof raw === "number" ? raw : Number(raw);
          return (
            <div
              key={s.key}
              className="flex items-center justify-between gap-3"
            >
              {multi && (
                <span className="flex items-center gap-1.5 text-text-subtle">
                  <span
                    className="inline-block h-2 w-2 shrink-0 rounded-[2px]"
                    style={{ background: s.color }}
                  />
                  {s.label}
                </span>
              )}
              <span className="font-medium tabular-nums text-foreground">
                {formatCompact(num)}
                {unit ? ` ${unit}` : ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ChartEmpty({
  height,
  className,
  title = "No data yet",
  hint,
}: {
  height: number;
  className?: string;
  title?: string;
  hint?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border px-3 text-center",
        className,
      )}
      style={{ height }}
    >
      <span className="text-xs text-text-subtle">{title}</span>
      {hint && <span className="text-[11px] text-text-subtle/70">{hint}</span>}
    </div>
  );
}

function ChartSkeleton({
  height,
  className,
}: {
  height: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md border border-border bg-surface-hover/40",
        className,
      )}
      style={{ height }}
    />
  );
}

/**
 * A full chart card body (NOT a sparkline) built on recharts — axes, horizontal
 * gridlines, area/line/bar rendering, multi-series (stacked area / multi-line),
 * and a unified dark DS-styled crosshair tooltip. First-class loading + empty
 * states. Client component (recharts).
 *
 * IMPORTANT: all hooks are called before any early return (rules-of-hooks).
 */
function Chart({
  data,
  series,
  kind,
  label,
  unit,
  xLabels,
  color = PRIMARY,
  className,
  height = 200,
  loading = false,
  emptyTitle,
  emptyHint,
}: ChartProps) {
  const gradientBase = React.useId().replace(/:/g, "");

  // Normalize to a set of named series. Single `data` becomes one series "v".
  const seriesMeta: SeriesMeta[] = React.useMemo(() => {
    if (series && series.length > 0) {
      return series.map((s, i) => ({
        key: `s${i}`,
        label: s.label,
        color: s.color || paletteFor(s.label, i),
      }));
    }
    return [{ key: "v", label: label ?? "value", color }];
  }, [series, label, color]);

  const points: Point[] = React.useMemo(() => {
    const cols =
      series && series.length > 0
        ? series.map((s) => s.values)
        : [Array.isArray(data) ? data : []];
    const n = Math.max(0, ...cols.map((c) => c.length));
    const out: Point[] = [];
    for (let i = 0; i < n; i++) {
      const row: Point = {
        i,
        x: xLabels?.[i] ?? (i === 0 ? "start" : i === n - 1 ? "now" : String(i)),
      };
      seriesMeta.forEach((s, si) => {
        const v = cols[si]?.[i];
        row[s.key] = Number.isFinite(v) ? (v as number) : 0;
      });
      out.push(row);
    }
    return out;
  }, [data, series, seriesMeta, xLabels]);

  const hasData = React.useMemo(() => {
    if (points.length < 2) return false;
    // At least one finite, non-flat-zero value across all series.
    return points.some((p) => seriesMeta.some((s) => Number(p[s.key]) !== 0));
  }, [points, seriesMeta]);

  const showTime = !!xLabels;

  // Only first / middle / last X ticks to avoid clutter.
  const { tickIndices } = React.useMemo(() => {
    const n = points.length;
    const midIdx = Math.floor((n - 1) / 2);
    return { tickIndices: new Set([0, midIdx, n - 1]) };
  }, [points.length]);

  const xTickFormatter = React.useCallback(
    (value: number) =>
      tickIndices.has(value) ? points[value]?.x ?? "" : "",
    [tickIndices, points],
  );

  // ---- early returns (AFTER all hooks) ----
  if (loading) {
    return <ChartSkeleton height={height} className={className} />;
  }
  if (!hasData) {
    return (
      <ChartEmpty
        height={height}
        className={className}
        title={emptyTitle}
        hint={emptyHint}
      />
    );
  }

  const axisTick = { fill: MUTED, fontSize: 10 };

  const commonAxes = (
    <>
      <CartesianGrid vertical={false} stroke={BORDER} strokeDasharray="3 3" />
      <XAxis
        dataKey="i"
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
    </>
  );

  const tooltip = (cursor: object) => (
    <Tooltip
      cursor={cursor}
      content={
        <CustomTooltip
          seriesMeta={seriesMeta}
          singleLabel={label}
          unit={unit}
          showTime={showTime}
        />
      }
    />
  );

  const margin = { top: 8, right: 8, bottom: 4, left: 0 };

  return (
    <div className={cn("w-full", className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {kind === "bar" ? (
          <BarChart data={points} margin={margin}>
            {commonAxes}
            {tooltip({ fill: "var(--surface-hover, rgba(255,255,255,0.04))" })}
            {seriesMeta.map((s) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                stackId={seriesMeta.length > 1 ? "a" : undefined}
                fill={s.color}
                radius={[2, 2, 0, 0]}
                maxBarSize={22}
              />
            ))}
          </BarChart>
        ) : kind === "line" ? (
          <LineChart data={points} margin={margin}>
            {commonAxes}
            {tooltip({ stroke: BORDER, strokeWidth: 1 })}
            {seriesMeta.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 3, fill: s.color, strokeWidth: 0 }}
              />
            ))}
          </LineChart>
        ) : (
          <AreaChart data={points} margin={margin}>
            <defs>
              {seriesMeta.map((s) => (
                <linearGradient
                  key={s.key}
                  id={`${gradientBase}-${s.key}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor={s.color} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
                </linearGradient>
              ))}
            </defs>
            {commonAxes}
            {tooltip({ stroke: BORDER, strokeWidth: 1 })}
            {seriesMeta.map((s) => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stackId={seriesMeta.length > 1 ? "a" : undefined}
                stroke={s.color}
                strokeWidth={2}
                fill={`url(#${gradientBase}-${s.key})`}
                fillOpacity={1}
                dot={false}
                activeDot={{ r: 3, fill: s.color, strokeWidth: 0 }}
              />
            ))}
          </AreaChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

/** Small muted legend row for multi-series charts (below/above the chart). */
function ChartLegend({
  series,
  className,
}: {
  series: ChartSeries[];
  className?: string;
}) {
  if (series.length < 2) return null;
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-subtle",
        className,
      )}
    >
      {series.map((s, i) => (
        <span key={i} className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-[2px]"
            style={{ background: s.color || paletteFor(s.label, i) }}
          />
          {s.label}
        </span>
      ))}
    </div>
  );
}

export { Chart, ChartLegend };
