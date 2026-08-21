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

export interface PluginResourceItem {
  id: string;
  name: string;
  /** Optional per-item health (e.g. a VPS server up/down). */
  state?: HealthState;
  /** Optional right-aligned meta line (e.g. "load 0.4 · disk 30% · ram 42%"). */
  meta?: string;
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
