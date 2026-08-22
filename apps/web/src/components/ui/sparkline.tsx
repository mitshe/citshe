import * as React from "react";

import { cn } from "@/lib/utils";

interface SparklineProps {
  /** Time-series values, oldest→newest. */
  values: number[];
  /** Rendering style. Defaults to "line". */
  kind?: "line" | "bar";
  className?: string;
  /** Accessible label (defaults to a generic one). */
  "aria-label"?: string;
}

// A compact viewBox — the SVG scales responsively via className (e.g. w-full)
// while preserving these internal coordinates. currentColor is used for the
// stroke/fill so the caller tints it (text-primary / text-muted-foreground …).
const VW = 100;
const VH = 28;
const PAD = 2; // keep the stroke off the very edge

/**
 * A dependency-free, pure-SVG sparkline. `line` draws a scaled polyline with a
 * subtle area fill; `bar` draws thin scaled bars. Inherits color via
 * currentColor and is mobile-friendly (responsive width via className).
 * Renders nothing for empty input and a flat line for a single value.
 */
function Sparkline({
  values,
  kind = "line",
  className,
  "aria-label": ariaLabel,
}: SparklineProps) {
  const data = React.useMemo(
    () => (Array.isArray(values) ? values.filter((v) => Number.isFinite(v)) : []),
    [values],
  );

  if (data.length === 0) return null;

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;

  // Map a value to a y-coordinate (higher value → smaller y, i.e. up).
  const toY = (v: number) => {
    const t = (v - min) / range; // 0..1
    return VH - PAD - t * (VH - PAD * 2);
  };

  const label = ariaLabel ?? "trend";

  if (kind === "bar") {
    const n = data.length;
    const slot = (VW - PAD * 2) / n;
    const gap = Math.min(slot * 0.35, 2);
    const barW = Math.max(slot - gap, 0.6);
    const barMax = max || 1; // bars scale from zero to max
    const baseY = VH - PAD;

    return (
      <svg
        viewBox={`0 0 ${VW} ${VH}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={label}
        className={cn("h-7 w-full overflow-visible", className)}
      >
        {data.map((v, i) => {
          const h = ((v / barMax) * (VH - PAD * 2));
          const x = PAD + i * slot + gap / 2;
          const y = baseY - h;
          return (
            <rect
              key={i}
              x={x}
              y={h <= 0 ? baseY - 0.5 : y}
              width={barW}
              height={h <= 0 ? 0.5 : h}
              rx={0.5}
              fill="currentColor"
            />
          );
        })}
      </svg>
    );
  }

  // line (default)
  const n = data.length;
  const step = n > 1 ? (VW - PAD * 2) / (n - 1) : 0;
  const points = data.map((v, i) => {
    const x = n > 1 ? PAD + i * step : VW / 2;
    return `${x.toFixed(2)},${toY(v).toFixed(2)}`;
  });
  const polyline = points.join(" ");
  // Area polygon: the line, then down to the baseline and back to the start.
  const first = points[0];
  const last = points[points.length - 1];
  const firstX = first.split(",")[0];
  const lastX = last.split(",")[0];
  const areaPoints = `${polyline} ${lastX},${VH - PAD} ${firstX},${VH - PAD}`;

  return (
    <svg
      viewBox={`0 0 ${VW} ${VH}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className={cn("h-7 w-full overflow-visible", className)}
    >
      <polygon points={areaPoints} fill="currentColor" opacity={0.08} />
      <polyline
        points={polyline}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export { Sparkline };
