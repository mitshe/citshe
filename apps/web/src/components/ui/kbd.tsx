import * as React from "react";

import { cn } from "@/lib/utils";

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center gap-0.5 rounded-sm border border-border bg-surface-hover px-1.5 font-mono text-xs font-medium text-muted-foreground leading-none",
        className,
      )}
      {...props}
    />
  );
}

export { Kbd };
