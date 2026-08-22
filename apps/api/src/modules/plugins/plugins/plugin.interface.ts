import { PluginType } from '@prisma/client';

export type HealthState = 'ok' | 'warn' | 'down' | 'idle';

export interface PluginMetric {
  label: string;
  value: string;
  hint?: string;
  state?: HealthState;
  /** UI placement hint: 'hero' | 'details' | 'usage'. Omit to auto-classify. */
  section?: 'hero' | 'details' | 'usage';
  /** Time-series values for a sparkline (oldest→newest). */
  series?: number[];
  /** Sparkline style; default 'line'. */
  seriesKind?: 'line' | 'bar';
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

/** One labelled stat inside a resource item's expandable details panel. */
export interface PluginResourceDetail {
  label: string;
  value: string;
  /** Optional health tint for the value (e.g. disk > 90% → down). */
  state?: HealthState;
}

export interface PluginResourceItem {
  id: string;
  name: string;
  /** Optional per-item health (e.g. a VPS server up/down). */
  state?: HealthState;
  /** Optional right-aligned meta line. */
  meta?: string;
  /**
   * Deployment groups only: true for the deployment currently SERVING
   * production traffic (Vercel project's production target / Cloudflare Pages'
   * latest successful production deploy).
   */
  active?: boolean;
  /** Deployment groups only: the deploy environment ("production"/"preview"). */
  environment?: string;
  /** Deployment groups only: git branch the deploy was built from. */
  branch?: string;
  /** Deployment groups only: short (7-char) commit sha. */
  sha?: string;
  /** Deployment groups only: commit author name. */
  author?: string;
  /** Deployment groups only: relative time of the deploy (e.g. "20d ago"). */
  when?: string;
  /**
   * Optional structured stats rendered as an expandable panel under the row
   * (e.g. a VPS server's uptime / load / RAM / disk / CPU / OS).
   */
  details?: PluginResourceDetail[];
  /**
   * Optional error message for this item (e.g. an unreachable VPS server),
   * shown inline on its own row rather than as a page-wide error.
   */
  error?: string;
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
