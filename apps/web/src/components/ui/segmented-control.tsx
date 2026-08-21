"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
}

interface SegmentedControlProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  className?: string;
  "aria-label"?: string;
}

function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  className,
  "aria-label": ariaLabel,
}: SegmentedControlProps<T>) {
  const activeIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const count = options.length || 1;

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      data-slot="segmented-control"
      className={cn(
        "relative inline-grid h-9 items-center rounded-full border border-border bg-surface-inset p-[3px]",
        className,
      )}
      style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
    >
      {/* sliding active pill */}
      <span
        aria-hidden
        className="absolute top-[3px] bottom-[3px] left-[3px] rounded-full bg-surface-card border border-border shadow-[0_0_0_1px_var(--accent-glow)] transition-linear"
        style={{
          width: `calc((100% - 6px) / ${count})`,
          transform: `translateX(${activeIndex * 100}%)`,
        }}
      />
      {options.map((option) => {
        const isActive = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(option.value)}
            className={cn(
              "relative z-10 inline-flex h-full items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 text-sm font-medium transition-linear",
              "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isActive
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export { SegmentedControl };
export type { SegmentedOption };
