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
  /**
   * If set, the plugin mutated its own config (e.g. VPS add/remove server) and
   * asks the service to persist (re-encrypt) this new config. runAction itself
   * has no DB access, so this is how a plugin writes config changes back.
   */
  config?: PluginConfig;
}

export type ResourceKind =
  | 'pages'
  | 'zones'
  | 'workers'
  | 'r2'
  // Vercel resource kinds
  | 'projects'
  | 'deployments'
  | 'domains'
  // VPS resource kinds
  | 'servers';

export interface PluginResourceItem {
  id: string;
  name: string;
  /** Optional per-item health (e.g. a VPS server up/down). */
  state?: HealthState;
  /** Optional right-aligned meta line. */
  meta?: string;
}

export interface PluginResourceGroup {
  kind: ResourceKind;
  label: string;
  items: PluginResourceItem[];
}

/** Per-portal selection of which resources to show. */
export interface PluginSelection {
  pages?: string[];
  zones?: string[];
  workers?: string[];
  r2?: string[];
  // Vercel
  projects?: string[];
  deployments?: string[];
  domains?: string[];
}

/** A preview/branch deployment surfaced from a deploy plugin. */
export interface PreviewDeployment {
  url: string;
  branch?: string;
  commit?: string;
  when?: string; // ISO
  state: HealthState;
  project?: string;
  provider: 'cloudflare' | 'vercel';
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
  /**
   * List recent preview / branch deployments (non-production), optionally
   * filtered to a repo. Lets citshe show a clickable preview URL per repo so
   * you test on a real deploy instead of running locally. Optional.
   */
  listPreviews?(
    config: PluginConfig,
    repoName?: string,
  ): Promise<PreviewDeployment[]>;
  /**
   * List the resources the token can see, grouped by kind, so the user can pick
   * which ones matter for this portal (checkboxes). Optional.
   */
  listResources?(config: PluginConfig): Promise<PluginResourceGroup[]>;
}
