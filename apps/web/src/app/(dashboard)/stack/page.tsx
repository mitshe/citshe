"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Plus, ChevronRight, Check, Boxes } from "lucide-react";
import { usePlugins } from "@/lib/api/hooks";
import { pluginCatalog, type PluginDef } from "@/lib/plugin-catalog";
import { ConnectDialog } from "@/components/plugins/plugin-dialogs";
import { EmptyState } from "@/components/ui/empty-state";

export default function StackPage() {
  const { data: plugins = [], isLoading } = usePlugins();
  const [dialog, setDialog] = useState<PluginDef | null>(null);

  const connectedTypes = new Set(plugins.map((p) => p.type));

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-6 sm:py-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Add a tool</h1>
        <p className="text-sm text-muted-foreground">
          Plug citshe into your stack. Each connected tool gets its own place in
          the sidebar.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : pluginCatalog.length === 0 ? (
        <EmptyState
          icon={<Boxes />}
          title="No tools available"
          description="There are no stack integrations to connect right now."
        />
      ) : (
        <div className="space-y-2.5">
          {pluginCatalog.map((def) => {
            const connected = connectedTypes.has(def.type);
            if (connected) {
              return (
                <Link
                  key={def.type}
                  href={`/stack/${def.type.toLowerCase()}`}
                  className="flex w-full items-center gap-3 rounded-md border border-border bg-surface-card px-4 py-3.5 transition-linear hover:bg-surface-hover"
                >
                  <span className={def.accent}>{def.icon}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{def.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {def.tagline}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-ok">
                    <Check className="h-3.5 w-3.5" />
                    Connected
                  </span>
                  <ChevronRight className="h-4 w-4 text-text-subtle" />
                </Link>
              );
            }
            return (
              <button
                key={def.type}
                onClick={() => setDialog(def)}
                className="flex w-full items-center gap-3 rounded-md border border-dashed border-border bg-surface-inset/40 px-4 py-3.5 text-left transition-linear hover:border-border-strong hover:bg-surface-hover"
              >
                <span className={def.accent}>{def.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{def.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {def.tagline}
                  </p>
                </div>
                <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                  <Plus className="h-3.5 w-3.5" />
                  Connect
                </span>
              </button>
            );
          })}
        </div>
      )}

      {dialog && <ConnectDialog def={dialog} onClose={() => setDialog(null)} />}
    </div>
  );
}
