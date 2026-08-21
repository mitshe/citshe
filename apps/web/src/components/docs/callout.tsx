import { Info, AlertTriangle, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";

type CalloutType = "info" | "warning" | "tip";

const config: Record<
  CalloutType,
  {
    icon: typeof Info;
    iconColor: string;
  }
> = {
  info: {
    icon: Info,
    iconColor: "text-info",
  },
  warning: {
    icon: AlertTriangle,
    iconColor: "text-warn",
  },
  tip: {
    icon: Lightbulb,
    iconColor: "text-ok",
  },
};

interface CalloutProps {
  type: CalloutType;
  children: React.ReactNode;
}

export function Callout({ type, children }: CalloutProps) {
  const { icon: Icon, iconColor } = config[type];

  return (
    <div className="my-6 flex gap-4 rounded-lg border border-border bg-surface-card p-4">
      <Icon className={cn("w-5 h-5 flex-shrink-0 mt-0.5", iconColor)} />
      <div className="text-sm leading-relaxed text-muted-foreground [&>p]:m-0 [&_a]:underline [&_strong]:font-semibold [&_strong]:text-foreground">
        {children}
      </div>
    </div>
  );
}
