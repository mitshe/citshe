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
  AlertTriangle,
} from "lucide-react";
import { AnthropicIcon, OpenRouterIcon } from "@/components/icons/brand-icons";
import { StatusDot } from "@/components/ui/status-dot";
import {
  useAICredentials,
  useAICredentialCredits,
  useCreateAICredential,
  useDeleteAICredential,
  useTestAICredentialBeforeConnect,
} from "@/lib/api/hooks";
import { useAuthToken } from "@/lib/api/hooks/shared";
import { api } from "@/lib/api/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { AICredential, AIProvider } from "@/lib/api/types";

/** Below this remaining balance ($), the OpenRouter card shows a danger treatment. */
const LOW_BALANCE_THRESHOLD = 5;

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
        <h1 className="text-2xl font-semibold tracking-tight">AI</h1>
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
                Runs inside each worker container, using your Claude
                subscription (no API key here). citshe keeps the login fresh
                automatically. If it ever expires, reconnect it right here — no
                terminal needed.
              </p>
              <div className="mt-3">
                <ReconnectClaude />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pillar 2 — a cheap key for small in-panel helpers */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium text-foreground">
            Panel AI · server-wide
          </h2>
          <p className="text-xs text-muted-foreground">
            One key powers the small in-panel helpers — “Improve with AI”,
            summaries, repo analysis — across ALL your portals. Optional, and
            separate from the Claude Code engine above. (GitHub, Cloudflare,
            Vercel and Neon stay per-project.)
          </p>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : panelKey ? (
          <ConnectedKeyCard
            credential={panelKey}
            onRemove={() => handleDelete(panelKey.id)}
          />
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

/** The connected Panel-AI credential card. For OpenRouter it also shows the
 *  remaining credit balance ("$12.40 left"), red under $5. Claude has no
 *  balance endpoint, so no balance line is shown for it. */
function ConnectedKeyCard({
  credential,
  onRemove,
}: {
  credential: AICredential;
  onRemove: () => void;
}) {
  const isOpenRouter = credential.provider === "OPENROUTER";
  const {
    data: credits,
    isLoading: creditsLoading,
  } = useAICredentialCredits(credential.id, isOpenRouter);

  const remaining = credits?.remaining;
  const isLow =
    typeof remaining === "number" && remaining < LOW_BALANCE_THRESHOLD;

  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-surface-card p-4">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface-inset">
        {isOpenRouter ? (
          <OpenRouterIcon className="h-5 w-5" />
        ) : (
          <AnthropicIcon className="h-5 w-5" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="font-medium text-foreground">
            {isOpenRouter ? "OpenRouter" : "Claude API"}
          </p>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <StatusDot state="ok" size={7} />
            Connected
          </span>
        </div>

        {/* Balance line — OpenRouter only. */}
        {isOpenRouter &&
          (creditsLoading ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Checking balance…
            </p>
          ) : typeof remaining === "number" ? (
            <div className="mt-1 flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-xs font-medium",
                  isLow ? "text-danger" : "text-foreground",
                )}
              >
                {isLow && <AlertTriangle className="h-3 w-3" />}
                {`$${remaining.toFixed(2)} left`}
              </span>
              {typeof credits?.totalUsage === "number" && (
                <span className="text-[11px] text-muted-foreground">
                  {`$${credits.totalUsage.toFixed(2)} used`}
                </span>
              )}
            </div>
          ) : null)}
      </div>
      <button
        onClick={onRemove}
        className="inline-flex items-center gap-1 self-start text-[11px] text-muted-foreground transition-linear hover:text-destructive"
      >
        <Trash2 className="h-3 w-3" />
        Remove
      </button>
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

/**
 * Reconnect the Claude engine from the panel — no terminal. Two steps:
 *  1. Start → the server runs `claude setup-token` and returns a sign-in URL.
 *  2. You open it, approve, copy the code, paste it here → the server finishes
 *     the login and stores a long-lived (~1-year) token for every portal.
 */
function ReconnectClaude() {
  const getToken = useAuthToken();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [starting, setStarting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setUrl(null);
    setCode("");
    setError(null);
    setStarting(false);
    setSubmitting(false);
  };

  const start = async () => {
    setOpen(true);
    reset();
    setStarting(true);
    try {
      const token = await getToken();
      const res = await api.orchestration.reloginStart(token);
      if (res.ok && res.url) setUrl(res.url);
      else setError(res.error ?? "Couldn't start sign-in. Try again.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start sign-in.");
    } finally {
      setStarting(false);
    }
  };

  const submit = async () => {
    if (!code.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await api.orchestration.reloginSubmit(code.trim(), token);
      if (res.ok) {
        toast.success("Claude reconnected — the engine is ready.");
        setOpen(false);
        reset();
      } else {
        setError(res.error ?? "That code didn't work. Try again.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't finish sign-in.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={start}>
        Reconnect Claude
      </Button>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) reset();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reconnect Claude</DialogTitle>
            <DialogDescription>
              Sign in with your Claude subscription — this gives citshe a
              long-lived token, so you won&apos;t get logged out.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            {starting ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Getting your sign-in link…
              </div>
            ) : url ? (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>1. Open this link and approve</Label>
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 truncate rounded-md border border-border bg-surface-inset px-3 py-2 text-sm text-primary transition-linear hover:bg-surface-hover"
                  >
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">Sign in to Claude</span>
                  </a>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="relogin-code">2. Paste the code here</Label>
                  <Input
                    id="relogin-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="Paste the code from Claude"
                    autoFocus
                  />
                </div>
              </div>
            ) : null}
            {error && (
              <p className="flex items-start gap-1.5 text-xs font-medium text-danger">
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                {error}
              </p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
                reset();
              }}
            >
              Cancel
            </Button>
            <Button onClick={submit} disabled={!url || !code.trim() || submitting}>
              {submitting ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-1.5 h-4 w-4" />
              )}
              Finish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
