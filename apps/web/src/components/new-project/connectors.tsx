"use client";

import { useState } from "react";
import { Check, ChevronDown, ExternalLink, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusDot } from "@/components/ui/status-dot";
import { usePlugins, useConnectPlugin } from "@/lib/api/hooks/plugins";
import {
  useIntegrations,
  useCreateIntegration,
} from "@/lib/api/hooks/integrations";
import { pluginCatalog } from "@/lib/plugin-catalog";
import type { PluginType } from "@/lib/api/types";

/**
 * The "connect your tools" section of the New-project wizard. Every connector
 * is a row with a status dot and an inline, guided connect panel — so a
 * non-technical user pastes a token step-by-step without leaving the flow.
 * GitHub is required (the worker creates the repo); the rest are recommended.
 */

type ConnectorKey = "GITHUB" | PluginType;

interface ConnectorDef {
  key: ConnectorKey;
  name: string;
  /** Plain-language reason, not jargon. */
  purpose: string;
  required?: boolean;
  /** Suggested for the likely stack (badge). */
  suggested?: boolean;
  docsUrl?: string;
  /** The single credential field to paste. */
  fieldLabel: string;
  fieldKey: string;
  guide: string[];
}

const CONNECTORS: ConnectorDef[] = [
  {
    key: "GITHUB",
    name: "GitHub",
    purpose: "Where your project's code lives",
    required: true,
    docsUrl: "https://github.com/settings/tokens/new",
    fieldLabel: "Access token",
    fieldKey: "accessToken",
    guide: [
      "Open github.com/settings/tokens (classic).",
      'Generate a token with the "repo" and "workflow" scopes.',
      "Copy it and paste it below.",
    ],
  },
  {
    key: "CLOUDFLARE",
    name: "Cloudflare",
    purpose: "Hosting for websites",
    suggested: true,
    docsUrl: "https://dash.cloudflare.com/profile/api-tokens",
    fieldLabel: "API token",
    fieldKey: "apiToken",
    guide: [
      "Open dash.cloudflare.com/profile/api-tokens.",
      'Click "Create Token" → use the "Edit Cloudflare Workers" template.',
      "Copy the token and paste it below.",
    ],
  },
  {
    key: "VERCEL",
    name: "Vercel",
    purpose: "Hosting for apps",
    docsUrl: "https://vercel.com/account/tokens",
    fieldLabel: "Token",
    fieldKey: "token",
    guide: [
      "Open vercel.com/account/tokens.",
      'Click "Create Token", give it a name, create it.',
      "Copy the token and paste it below.",
    ],
  },
  {
    key: "NEON",
    name: "Neon",
    purpose: "Database (when the project needs one)",
    docsUrl: "https://console.neon.tech/app/settings/api-keys",
    fieldLabel: "API key",
    fieldKey: "apiKey",
    guide: [
      "Open console.neon.tech/app/settings/api-keys.",
      'Click "Create new API key".',
      "Copy the key and paste it below.",
    ],
  },
];

export function Connectors() {
  const { data: plugins } = usePlugins();
  const { data: integrations } = useIntegrations();

  const isConnected = (key: ConnectorKey): boolean => {
    if (key === "GITHUB") {
      return !!integrations?.some(
        (i) => i.type === "GITHUB" && i.status === "CONNECTED",
      );
    }
    return !!plugins?.some((p) => p.type === key && p.status === "CONNECTED");
  };

  return (
    <div className="divide-y divide-border rounded-lg border border-border">
      {CONNECTORS.map((c) => (
        <ConnectorRow key={c.key} def={c} connected={isConnected(c.key)} />
      ))}
    </div>
  );
}

function ConnectorRow({
  def,
  connected,
}: {
  def: ConnectorDef;
  connected: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  const connectPlugin = useConnectPlugin();
  const createIntegration = useCreateIntegration();

  const save = async () => {
    const token = value.trim();
    if (!token || saving) return;
    setSaving(true);
    try {
      if (def.key === "GITHUB") {
        await createIntegration.mutateAsync({
          type: "GITHUB",
          config: { mode: "pat", [def.fieldKey]: token },
        });
      } else {
        // The catalog knows the exact config shape per plugin; find its first
        // required field key so we send what the backend expects.
        const catalog = pluginCatalog.find((p) => p.type === def.key);
        const primaryKey =
          catalog?.fields.find((f) => f.required)?.key ?? def.fieldKey;
        await connectPlugin.mutateAsync({
          type: def.key as PluginType,
          config: { [primaryKey]: token },
        });
      }
      toast.success(`${def.name} connected`);
      setOpen(false);
      setValue("");
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : `Couldn't connect ${def.name} — check the token.`,
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="px-3.5 py-3">
      <div className="flex items-center gap-3">
        <StatusDot state={connected ? "ok" : "idle"} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">
              {def.name}
            </span>
            {def.required && (
              <span className="rounded bg-surface-inset px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-text-subtle">
                required
              </span>
            )}
            {def.suggested && !connected && (
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                suggested
              </span>
            )}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {connected ? "Connected" : def.purpose}
          </p>
        </div>
        {connected ? (
          <span className="flex items-center gap-1 text-xs font-medium text-ok">
            <Check className="size-3.5" />
          </span>
        ) : (
          <Button
            variant={def.required ? "primary" : "outline"}
            size="sm"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <Plus className="size-3.5" />
            )}
            Connect
          </Button>
        )}
      </div>

      {open && !connected && (
        <div className="mt-3 space-y-3 rounded-md border border-border bg-surface-inset/50 p-3">
          <ol className="space-y-1.5 text-xs text-muted-foreground">
            {def.guide.map((step, i) => (
              <li key={i} className="flex gap-2">
                <span className="font-medium text-text-subtle">{i + 1}.</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          {def.docsUrl && (
            <a
              href={def.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-primary transition-linear hover:underline"
            >
              Open {def.name} <ExternalLink className="size-3" />
            </a>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs">{def.fieldLabel}</Label>
            <div className="flex gap-2">
              <Input
                type="password"
                autoComplete="off"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={`Paste your ${def.name} ${def.fieldLabel.toLowerCase()}`}
                onKeyDown={(e) => {
                  if (e.key === "Enter") save();
                }}
              />
              <Button onClick={save} disabled={!value.trim() || saving}>
                {saving && <Loader2 className="size-3.5 animate-spin" />}
                Save
              </Button>
            </div>
            <p className={cn("text-[11px] text-text-subtle")}>
              Encrypted. We never log it.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
