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

/** Normalized status every plugin returns — the shape the UI renders. */
export interface PluginStatus {
  type: PluginType;
  connected: boolean;
  headline: { label: string; state: HealthState };
  metrics: PluginMetric[];
  items?: PluginItem[];
  links?: PluginLink[];
  error?: string;
}

export type PluginConfig = Record<string, unknown>;

/**
 * A stack tool (Cloudflare / Neon / Google Ads). Read-only in v1: it can test
 * a connection and report a normalized status, so citshe answers "is it live,
 * did the migration run, is the file on R2" without you opening 4 dashboards.
 */
export interface StackPlugin {
  type: PluginType;
  /** Validate a config (used by the connect dialog's Test button). */
  testConnection(config: PluginConfig): Promise<{ ok: boolean; error?: string }>;
  /** Fetch the live, normalized status shown on the card / home dashboard. */
  getStatus(config: PluginConfig): Promise<PluginStatus>;
}
