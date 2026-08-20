import { PluginType } from '@prisma/client';

export type HealthState = 'ok' | 'warn' | 'down' | 'idle';

export interface PluginMetric {
  label: string;
  value: string;
  hint?: string;
  state?: HealthState;
}

export interface PluginItem {
  label: string;
  value: string;
  state?: HealthState;
}

export interface PluginLink {
  label: string;
  url: string;
}

/** A write-action a plugin can perform (e.g. "Redeploy"). Rendered as a button. */
export interface PluginAction {
  id: string;
  label: string;
  /** Ask the user to confirm first (destructive / production-affecting). */
  confirm?: boolean;
  /** Free-form context (e.g. which project the action targets). */
  target?: string;
  /** If set, prompt the user for a value first; sent as input.value. */
  prompt?: string;
}

/** Normalized status every plugin returns — the shape the UI renders. */
export interface PluginStatus {
  type: PluginType;
  connected: boolean;
  headline: { label: string; state: HealthState };
  metrics: PluginMetric[];
  items?: PluginItem[];
  links?: PluginLink[];
  actions?: PluginAction[];
  error?: string;
}

export type PluginConfig = Record<string, unknown>;

export interface PluginActionResult {
  ok: boolean;
  message: string;
}

/**
 * A stack tool (Cloudflare / Vercel / Neon / Google Ads / VPS). Reports a
 * normalized status so citshe answers "is it live, did the migration run, is
 * the file on R2" without opening 4 dashboards — and can run a few write
 * actions (redeploy, add subdomain) when the plugin exposes them.
 */
export interface StackPlugin {
  type: PluginType;
  /** Validate a config (used by the connect dialog's Test button). */
  testConnection(config: PluginConfig): Promise<{ ok: boolean; error?: string }>;
  /** Fetch the live, normalized status shown on the card / home dashboard. */
  getStatus(config: PluginConfig): Promise<PluginStatus>;
  /** Run a write-action exposed in status.actions. Optional. */
  runAction?(
    config: PluginConfig,
    actionId: string,
    input?: Record<string, unknown>,
  ): Promise<PluginActionResult>;
}
