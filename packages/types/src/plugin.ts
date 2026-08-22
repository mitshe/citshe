// Plugin types — stack tools (Cloudflare / Vercel / Neon / Google Ads / VPS) per portal.

export type PluginType =
  | "CLOUDFLARE"
  | "VERCEL"
  | "NEON"
  | "GOOGLE_ADS"
  | "VPS";

export type PluginConnStatus = "CONNECTED" | "ERROR" | "DISCONNECTED";

export interface Plugin {
  id: string;
  organizationId: string;
  type: PluginType;
  status: PluginConnStatus;
  label: string | null;
  lastCheckedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Traffic-light health used across plugin cards. */
export type HealthState = "ok" | "warn" | "down" | "idle";

export interface PluginMetric {
  label: string;
  value: string;
  hint?: string;
  state?: HealthState;
  /**
   * Where the plugin detail UI should place this metric. `hero` = the top
   * headline strip (live state / last deploy). `details` = the right-rail
   * "Details" block (properties: region, plan, version…). `usage` = the
   * right-rail "Usage" block (storage, compute, transfer, traffic). When
   * omitted the UI classifies by label.
   */
  section?: "hero" | "details" | "usage";
  /** Time-series values for a chart (oldest→newest). */
  series?: number[];
  /**
   * Chart style. `area` = filled line for continuous traffic, `line` = plain
   * line for rates, `bar` = discrete counts per bucket (deploys/day, ops/hour).
   * ('line' kept for back-compat; treated as area-or-line by the renderer.)
   */
  seriesKind?: "area" | "line" | "bar";
  /**
   * Multiple named series sharing one X axis (e.g. HTTP status split
   * 2xx/3xx/4xx/5xx, or requests+errors). Rendered as a stacked area / multi
   * line. When set, takes precedence over `series` for the chart.
   */
  seriesMulti?: { label: string; values: number[]; color?: string }[];
  /** Per-point time labels for the X axis (same length as the series). */
  seriesLabels?: string[];
  /**
   * Change vs the previous period, for a big-number tile (e.g. "+1.7%"). The
   * sign drives the up/down tint. Purely presentational.
   */
  delta?: string;
  /** Whether `delta` is a good or bad direction (green vs red). */
  deltaGood?: boolean;
  /** Optional unit shown after the value / in the chart tooltip. */
  unit?: string;
}

export interface PluginLink {
  label: string;
  url: string;
}

export interface PluginItem {
  label: string;
  value: string;
  state?: HealthState;
}

/** A write-action a plugin exposes (rendered as a button on the card). */
export interface PluginAction {
  id: string;
  label: string;
  confirm?: boolean;
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

export interface ConnectPluginDto {
  type: PluginType;
  config: Record<string, unknown>;
}

export interface PluginTestResult {
  success: boolean;
  message: string;
}

export interface PluginActionResult {
  ok: boolean;
  message: string;
}

export type ResourceKind =
  | "pages"
  | "zones"
  | "workers"
  | "r2"
  // Vercel resource kinds
  | "projects"
  | "deployments"
  | "domains"
  // VPS resource kinds
  | "servers";

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
  /** Optional right-aligned meta line (e.g. "load 0.4 · disk 30% · ram 42%"). */
  meta?: string;
  /**
   * Deployment groups only: true for the deployment currently SERVING
   * production traffic (Vercel project's production target / Cloudflare Pages'
   * latest successful production deploy). Rendered with a "Live" badge and a
   * highlighted row so you can see at a glance what's live right now.
   */
  active?: boolean;
  /**
   * Deployment groups only: the deploy environment ("production" / "preview").
   * Lets the UI badge previews and highlight production without re-parsing meta.
   */
  environment?: string;
  /** Deployment groups only: git branch the deploy was built from. */
  branch?: string;
  /** Deployment groups only: short (7-char) commit sha. */
  sha?: string;
  /** Deployment groups only: commit author name, shown as a subtle secondary. */
  author?: string;
  /** Deployment groups only: relative time of the deploy (e.g. "20d ago"). */
  when?: string;
  /**
   * Optional structured stats rendered as an expandable panel under the row
   * (e.g. a VPS server's uptime / load / RAM / disk / CPU / OS). Cleaner than
   * cramming everything into `meta`.
   */
  details?: PluginResourceDetail[];
  /**
   * Optional error message for this item (e.g. an unreachable VPS server),
   * shown inline on its own row rather than as a page-wide error.
   */
  error?: string;
}

/** One SSH server inside the VPS plugin's list of servers. */
export interface VpsServer {
  id: string;
  label: string;
  host: string;
  port?: number | string;
  username: string;
  authMethod?: "key" | "password";
  privateKey?: string;
  passphrase?: string;
  password?: string;
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
  // VPS
  servers?: string[];
}

/** Response of GET /plugins/:type/resources. */
export interface PluginResources {
  groups: PluginResourceGroup[];
  selected: PluginSelection;
}

/** A preview/branch deployment surfaced from a deploy plugin. */
export interface PreviewDeployment {
  url: string;
  branch?: string;
  commit?: string;
  when?: string;
  state: HealthState;
  project?: string;
  provider: "cloudflare" | "vercel";
}
