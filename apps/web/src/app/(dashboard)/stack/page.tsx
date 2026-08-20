"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Plus, ChevronRight, Check } from "lucide-react";
import { usePlugins } from "@/lib/api/hooks";
import { pluginCatalog, type PluginDef } from "@/lib/plugin-catalog";
import { ConnectDialog } from "@/components/plugins/plugin-dialogs";

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
      ) : (
        <div className="space-y-3">
          {pluginCatalog.map((def) => {
            const connected = connectedTypes.has(def.type);
            if (connected) {
              return (
                <Link
                  key={def.type}
                  href={`/stack/${def.type.toLowerCase()}`}
                  className="flex w-full items-center gap-3 rounded-xl border border-border bg-background/50 px-4 py-3.5 transition-colors hover:bg-muted/40"
                >
                  <span className={def.accent}>{def.icon}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{def.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {def.tagline}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-500">
                    <Check className="h-3.5 w-3.5" />
                    Connected
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              );
            }
            return (
              <button
                key={def.type}
                onClick={() => setDialog(def)}
                className="flex w-full items-center gap-3 rounded-xl border border-dashed border-border bg-muted/10 px-4 py-3.5 text-left transition-colors hover:border-primary/40 hover:bg-muted/30"
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

      {dialog && (
        <ConnectDialog def={dialog} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}
