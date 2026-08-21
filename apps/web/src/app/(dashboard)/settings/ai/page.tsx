"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Loader2,
  Trash2,
  Eye,
  EyeOff,
  Check,
  Terminal,
  ExternalLink,
} from "lucide-react";
import { AnthropicIcon, OpenRouterIcon } from "@/components/icons/brand-icons";
import { StatusDot } from "@/components/ui/status-dot";
import {
  useAICredentials,
  useCreateAICredential,
  useDeleteAICredential,
  useTestAICredentialBeforeConnect,
} from "@/lib/api/hooks";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { AIProvider } from "@/lib/api/types";

/** The two API-key providers offered for panel-side small tasks. */
const PANEL_PROVIDERS: {
  provider: Extract<AIProvider, "CLAUDE" | "OPENROUTER">;
  name: string;
  description: string;
  icon: React.ReactNode;
  placeholder: string;
  docsUrl: string;
}[] = [
  {
    provider: "OPENROUTER",
    name: "OpenRouter",
    description: "One key, 100+ models. Cheapest for small tasks.",
    icon: <OpenRouterIcon className="h-5 w-5" />,
    placeholder: "sk-or-...",
    docsUrl: "https://openrouter.ai/keys",
  },
  {
    provider: "CLAUDE",
    name: "Claude API",
    description: "Anthropic API key — for panel tasks with Claude.",
    icon: <AnthropicIcon className="h-5 w-5" />,
    placeholder: "sk-ant-...",
    docsUrl: "https://console.anthropic.com/settings/keys",
  },
];

export default function AICredentialsPage() {
  const { data: credentials = [], isLoading } = useAICredentials();
  const createCredential = useCreateAICredential();
  const deleteCredential = useDeleteAICredential();
  const testBeforeConnect = useTestAICredentialBeforeConnect();

  const [connectDef, setConnectDef] = useState<
    (typeof PANEL_PROVIDERS)[number] | null
  >(null);

  const byProvider = new Map(credentials.map((c) => [c.provider, c]));
  const panelKey = credentials.find(
    (c) => c.provider === "CLAUDE" || c.provider === "OPENROUTER",
  );

  const handleDelete = async (id: string) => {
    try {
      await deleteCredential.mutateAsync(id);
      toast.success("Removed");
    } catch {
      toast.error("Failed to remove");
    }
  };

  return (
    <div className="w-full space-y-8 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">AI</h1>
        <p className="text-sm text-muted-foreground">
          How citshe runs work and helps you in the panel.
        </p>
      </div>

      {/* Pillar 1 — the engine that does the actual work */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium text-foreground">Agent engine</h2>
          <p className="text-xs text-muted-foreground">
            Workers that clone a repo, write code and open a PR.
          </p>
        </div>
        <div className="rounded-md border border-border bg-surface-card p-4">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-[#D97757]/10 text-[#D97757]">
              <Terminal className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-foreground">Claude Code</span>
                <span className="rounded-sm border border-border bg-surface-inset px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  subscription
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Runs inside each worker container. Authenticated once on your
                server with{" "}
                <code className="rounded-sm border border-border bg-surface-inset px-1 py-0.5 font-mono text-xs">
                  claude /login
                </code>{" "}
                — no API key here. This is the engine; it uses your Claude
                subscription, not per-token billing.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Pillar 2 — a cheap key for small in-panel helpers */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium text-foreground">Panel AI</h2>
          <p className="text-xs text-muted-foreground">
            Small in-panel helpers — “Improve with AI”, summaries. Optional.
            This is the panel key, separate from the Claude Code engine above.
          </p>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : panelKey ? (
          <div className="flex items-center gap-3 rounded-md border border-border bg-surface-card p-4">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface-inset">
              {panelKey.provider === "OPENROUTER" ? (
                <OpenRouterIcon className="h-5 w-5" />
              ) : (
                <AnthropicIcon className="h-5 w-5" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="font-medium text-foreground">
                  {panelKey.provider === "OPENROUTER"
                    ? "OpenRouter"
                    : "Claude API"}
                </p>
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <StatusDot state="ok" size={7} />
                  Connected
                </span>
              </div>
            </div>
            <button
              onClick={() => handleDelete(panelKey.id)}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-linear hover:text-destructive"
            >
              <Trash2 className="h-3 w-3" />
              Remove
            </button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {PANEL_PROVIDERS.map((def) => (
              <button
                key={def.provider}
                onClick={() => setConnectDef(def)}
                disabled={byProvider.has(def.provider)}
                className="flex items-start gap-3 rounded-md border border-dashed border-border bg-surface-inset/40 p-4 text-left transition-linear hover:border-primary/40 hover:bg-surface-hover disabled:opacity-50"
              >
                <span className="shrink-0">{def.icon}</span>
                <div className="min-w-0">
                  <p className="font-medium text-foreground">Connect {def.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {def.description}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {connectDef && (
        <ConnectKeyDialog
          def={connectDef}
          onClose={() => setConnectDef(null)}
          onConnect={async (apiKey) => {
            const test = await testBeforeConnect.mutateAsync({
              provider: connectDef.provider,
              apiKey,
            });
            if (!test.success) {
              throw new Error(test.message || "Connection test failed");
            }
            await createCredential.mutateAsync({
              provider: connectDef.provider,
              apiKey,
              isDefault: true,
            });
          }}
        />
      )}
    </div>
  );
}

function ConnectKeyDialog({
  def,
  onClose,
  onConnect,
}: {
  def: (typeof PANEL_PROVIDERS)[number];
  onClose: () => void;
  onConnect: (apiKey: string) => Promise<void>;
}) {
  const [apiKey, setApiKey] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  const connect = async () => {
    if (!apiKey.trim()) {
      toast.error("Enter an API key");
      return;
    }
    setBusy(true);
    try {
      await onConnect(apiKey.trim());
      toast.success(`${def.name} connected`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to connect");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span>{def.icon}</span>
            <div>
              <DialogTitle>Connect {def.name}</DialogTitle>
              <DialogDescription>{def.description}</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <a
            href={def.docsUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            Get an API key
          </a>
          <div className="space-y-1.5">
            <Label htmlFor="apiKey">API Key</Label>
            <div className="relative">
              <Input
                id="apiKey"
                type={show ? "text" : "password"}
                placeholder={def.placeholder}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {show ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={connect} disabled={busy}>
            {busy ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Check className={cn("mr-1.5 h-4 w-4")} />
            )}
            Connect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
