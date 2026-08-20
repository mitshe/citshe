// Plugin types — stack tools (Cloudflare / Neon / Google Ads) per portal.

export type PluginType = "CLOUDFLARE" | "NEON" | "GOOGLE_ADS";

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

export interface ConnectPluginDto {
  type: PluginType;
  config: Record<string, unknown>;
}

export interface PluginTestResult {
  success: boolean;
  message: string;
}
