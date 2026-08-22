import { PluginType } from '@prisma/client';
import {
  PluginConfig,
  PluginStatus,
  StackPlugin,
  PluginMetric,
  PluginItem,
  PluginResourceGroup,
  PluginResourceItem,
  ResourceKind,
  HealthState,
} from './plugin.interface';
import { pluginRegistry } from './plugin.registry';

const API = 'https://console.neon.tech/api/v2';

interface NeonConfig {
  apiKey: string;
  /** Optional — when omitted we discover projects and use the first. */
  projectId?: string;
}

function headers(key: string) {
  return { Authorization: `Bearer ${key}`, Accept: 'application/json' };
}

function bytes(n: number): string {
  const mb = n / (1024 * 1024);
  if (mb < 1) return `${(n / 1024).toFixed(0)} KB`;
  if (mb < 1024) return `${mb.toFixed(0)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Human-readable duration from seconds (compute/active time). */
function duration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = seconds / 60;
  if (m < 60) return `${m.toFixed(0)}m`;
  const h = m / 60;
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

type Rec = Record<string, unknown>;

/** Map a Neon operation status → our normalized health. */
function opHealth(status?: string): HealthState {
  switch (status) {
    case 'finished':
      return 'ok';
    case 'running':
    case 'scheduling':
    case 'cancelling':
      return 'warn';
    case 'failed':
    case 'error':
      return 'down';
    case 'cancelled':
    case 'skipped':
      return 'idle';
    default:
      return 'idle';
  }
}

/** Map a compute endpoint state → our normalized health. */
function computeHealth(state?: string): HealthState {
  switch (state) {
    case 'active':
      return 'ok';
    case 'init':
      return 'warn';
    case 'idle':
      return 'idle';
    default:
      return 'idle';
  }
}

/**
 * Neon (Postgres) plugin. Answers "is the DB alive / how big / how busy /
 * last active" — the pieces behind "did the migration run, are the data
 * there, is compute awake". Connect with an API key; the project is either
 * pinned in config or discovered (first project the key can see).
 */
class NeonPlugin implements StackPlugin {
  type = PluginType.NEON;

  private cfg(config: PluginConfig): NeonConfig {
    return config as unknown as NeonConfig;
  }

  /** Authed GET → parsed JSON. Throws on non-2xx so callers can try/catch. */
  private async get(key: string, path: string): Promise<Rec> {
    const res = await fetch(`${API}${path}`, { headers: headers(key) });
    if (!res.ok) throw new Error(`Neon returned ${res.status}`);
    return (await res.json()) as Rec;
  }

  /** Resolve the project id to inspect: pinned config, else the first project. */
  private async resolveProjectId(
    key: string,
    pinned?: string,
  ): Promise<string | undefined> {
    if (pinned) return pinned;
    try {
      const json = await this.get(key, '/projects');
      const projects = (json.projects as Rec[]) ?? [];
      return projects[0]?.id as string | undefined;
    } catch {
      return undefined;
    }
  }

  async testConnection(config: PluginConfig) {
    const { apiKey, projectId } = this.cfg(config);
    if (!apiKey) return { ok: false, error: 'An API key is required.' };
    try {
      // A pinned project must resolve; otherwise just prove the key lists projects.
      const path = projectId ? `/projects/${projectId}` : '/projects';
      const res = await fetch(`${API}${path}`, { headers: headers(apiKey) });
      if (!res.ok) return { ok: false, error: `Neon returned ${res.status}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async getStatus(config: PluginConfig): Promise<PluginStatus> {
    const { apiKey, projectId: pinned } = this.cfg(config);
    const metrics: PluginMetric[] = [];
    const items: PluginItem[] = [];
    let headline: { label: string; state: HealthState } = {
      label: 'Connected',
      state: 'ok',
    };

    const projectId = await this.resolveProjectId(apiKey, pinned);

    // No project in scope → still "connected", but nothing to detail.
    if (!projectId) {
      return {
        type: this.type,
        connected: true,
        headline: { label: 'Connected', state: 'ok' },
        metrics: [{ label: 'Neon', value: 'connected' }],
        links: [{ label: 'Open in Neon', url: 'https://console.neon.tech/app' }],
      };
    }

    // --- Project details: size, region, pg version, compute autoscaling ---
    let project: Rec | undefined;
    try {
      const json = await this.get(apiKey, `/projects/${projectId}`);
      project = json.project as Rec | undefined;
    } catch {
      // project detail optional
    }

    if (project) {
      const storage =
        (project.synthetic_storage_size as number | undefined) ??
        (project.data_storage_bytes as number | undefined);
      if (storage != null) {
        metrics.push({ label: 'Size', value: bytes(storage), section: 'usage' });
      }
      if (project.region_id) {
        metrics.push({
          label: 'Region',
          value: String(project.region_id),
          section: 'details',
        });
      }
      if (project.pg_version) {
        metrics.push({
          label: 'PG version',
          value: String(project.pg_version),
          section: 'details',
        });
      }
      const des = project.default_endpoint_settings as Rec | undefined;
      const min = des?.autoscaling_limit_min_cu as number | undefined;
      const max = des?.autoscaling_limit_max_cu as number | undefined;
      if (min != null || max != null) {
        const range =
          min != null && max != null && min !== max
            ? `${min}–${max} CU`
            : `${max ?? min} CU`;
        metrics.push({ label: 'Compute', value: range, section: 'details' });
      }

      // IP restrictions (project settings → ip_allow / allowed_ips).
      const settings = project.settings as Rec | undefined;
      const ipAllow =
        (settings?.allowed_ips as Rec | undefined) ??
        (project.allowed_ips as Rec | undefined);
      const ipList =
        (ipAllow?.ips as unknown[] | undefined) ??
        (project.ip_allow as unknown[] | undefined);
      if (ipAllow || Array.isArray(ipList)) {
        const count = Array.isArray(ipList) ? ipList.length : 0;
        metrics.push({
          label: 'IP restrictions',
          value: count > 0 ? `${count} allowed` : 'None set',
          section: 'details',
        });
      }

      // History retention window (seconds → hours).
      const retention = project.history_retention_seconds as number | undefined;
      if (retention != null) {
        const hours = retention / 3600;
        metrics.push({
          label: 'History retention',
          value: hours >= 1 ? `${hours.toFixed(0)}h` : `${Math.round(retention / 60)}m`,
          section: 'details',
        });
      }
    }

    // --- Branches: default branch name + count ---
    let branches: Rec[] = [];
    let primary: Rec | undefined;
    try {
      const json = await this.get(apiKey, `/projects/${projectId}/branches`);
      branches = (json.branches as Rec[]) ?? [];
      primary = branches.find((b) => b.primary || b.default) ?? branches[0];
      if (primary?.name) {
        metrics.push({
          label: 'Branch',
          value: String(primary.name),
          section: 'details',
        });
      }
      if (branches.length) {
        metrics.push({
          label: 'Branches',
          value: String(branches.length),
          section: 'details',
        });
      }
    } catch {
      // branches optional
    }

    // --- Compute endpoints on the primary branch: awake/idle + size ---
    if (primary?.id) {
      try {
        const json = await this.get(
          apiKey,
          `/projects/${projectId}/branches/${primary.id as string}/endpoints`,
        );
        const endpoints = (json.endpoints as Rec[]) ?? [];
        const rw = endpoints.find((e) => e.type === 'read_write') ?? endpoints[0];
        if (rw) {
          const state = rw.current_state as string | undefined;
          const health = computeHealth(state);
          metrics.push({
            label: 'Compute state',
            value: state === 'active' ? 'active' : state === 'idle' ? 'idle' : (state ?? 'unknown'),
            state: health,
            section: 'hero',
          });
          // Card headline reflects whether compute is awake.
          headline = {
            label: state === 'active' ? 'Active' : state === 'idle' ? 'Idle' : 'Connected',
            state: health,
          };
        }
      } catch {
        // endpoints optional
      }

      // --- Databases count ---
      try {
        const json = await this.get(
          apiKey,
          `/projects/${projectId}/branches/${primary.id as string}/databases`,
        );
        const dbs = (json.databases as Rec[]) ?? [];
        if (dbs.length) {
          metrics.push({
            label: 'Databases',
            value: String(dbs.length),
            section: 'details',
          });
        }
      } catch {
        // databases optional
      }

      // --- Roles count ---
      try {
        const json = await this.get(
          apiKey,
          `/projects/${projectId}/branches/${primary.id as string}/roles`,
        );
        const roles = (json.roles as Rec[]) ?? [];
        if (roles.length) {
          metrics.push({
            label: 'Roles',
            value: String(roles.length),
            section: 'details',
          });
        }
      } catch {
        // roles optional
      }
    }

    // --- Data API (branch/project exposes an enabled flag) ---
    {
      const branchDataApi =
        (primary?.data_api as Rec | undefined) ??
        (primary?.data_api_enabled as boolean | undefined);
      const projectDataApi =
        (project?.data_api as Rec | undefined) ??
        (project?.data_api_enabled as boolean | undefined);
      const dataApi = branchDataApi ?? projectDataApi;
      if (dataApi !== undefined) {
        const enabled =
          typeof dataApi === 'boolean'
            ? dataApi
            : Boolean((dataApi as Rec)?.enabled);
        metrics.push({
          label: 'Data API',
          value: enabled ? 'Enabled' : 'Not enabled',
          section: 'details',
        });
      }
    }

    // --- Monthly compute usage (from project consumption fields) ---
    // Billing period start (if the project exposes it) becomes the "since" hint.
    let periodStart: string | undefined;
    const rawPeriodStart =
      (project?.consumption_period_start as string | undefined) ??
      (project?.billing_period_start as string | undefined);
    if (rawPeriodStart) {
      const d = new Date(rawPeriodStart);
      if (!Number.isNaN(d.getTime())) {
        periodStart = `since ${d.toISOString().slice(0, 10)}`;
      }
    }
    if (project?.compute_time_seconds != null) {
      metrics.push({
        label: 'Compute used',
        value: duration(project.compute_time_seconds as number),
        hint: periodStart ?? 'this billing period',
        section: 'usage',
      });
    }
    if (project?.data_transfer_bytes != null) {
      metrics.push({
        label: 'Data transfer',
        value: bytes(project.data_transfer_bytes as number),
        hint: 'this billing period',
        section: 'usage',
      });
    }

    // --- Recent activity via operations → "Last activity" + a small feed ---
    // Fetch enough operations (limit=100) to cover a 48h compute-activity
    // histogram; the "Last activity" metric + feed only use the newest few.
    try {
      const json = await this.get(
        apiKey,
        `/projects/${projectId}/operations?limit=100`,
      );
      const ops = (json.operations as Rec[]) ?? [];
      const latest = ops[0];
      if (latest?.created_at) {
        metrics.push({
          label: 'Last activity',
          value: timeAgo(latest.created_at as string),
          state: opHealth(latest.status as string | undefined),
          section: 'details',
        });
      }
      for (const op of ops.slice(0, 5)) {
        if (!op.created_at) continue;
        items.push({
          label: String(op.action ?? 'operation'),
          value: timeAgo(op.created_at as string),
          state: opHealth(op.status as string | undefined),
        });
      }

      // --- Compute activity: ops-per-hour bar sparkline over the last 48h ---
      // Metrics/consumption API is 403 on free plans, so derive a histogram
      // from operation timestamps instead. 48 buckets, one per hour,
      // oldest→newest, ending at the current hour.
      try {
        const HOUR_MS = 3600 * 1000;
        const nowHour = Math.floor(Date.now() / HOUR_MS) * HOUR_MS;
        const windowStart = nowHour - 47 * HOUR_MS;
        const counts = new Array<number>(48).fill(0);
        let total = 0;
        for (const op of ops) {
          if (!op.created_at) continue;
          const t = new Date(op.created_at as string).getTime();
          if (Number.isNaN(t)) continue;
          const idx = Math.floor((t - windowStart) / HOUR_MS);
          if (idx < 0 || idx > 47) continue; // outside the 48h window
          counts[idx]++;
          total++;
        }
        // Only surface the chart when there is real activity in the window.
        if (total > 0) {
          metrics.push({
            label: 'Compute activity',
            value: `${total} ops`,
            hint: 'last 48h',
            series: counts,
            seriesKind: 'bar',
            section: 'usage',
          });
        }
      } catch {
        // histogram optional — never break status on a chart
      }
    } catch {
      // operations optional
    }

    if (metrics.length === 0) {
      metrics.push({ label: 'Neon', value: 'connected' });
    }

    return {
      type: this.type,
      connected: true,
      headline,
      metrics,
      items: items.length ? items : undefined,
      links: [
        {
          label: 'Open in Neon',
          url: `https://console.neon.tech/app/projects/${projectId}`,
        },
      ],
    };
  }

  /**
   * Everything the key can see for the resolved project, grouped — branches,
   * compute endpoints, databases, roles, and a recent-operations activity
   * feed. Each section is independently resilient (403/absent → skipped).
   */
  async listResources(config: PluginConfig): Promise<PluginResourceGroup[]> {
    const { apiKey, projectId: pinned } = this.cfg(config);
    const groups: PluginResourceGroup[] = [];

    const projectId = await this.resolveProjectId(apiKey, pinned);

    // No pinned project → expose the Projects list so the user can pick one.
    if (!pinned || !projectId) {
      try {
        const json = await this.get(apiKey, '/projects');
        const projects = (json.projects as Rec[]) ?? [];
        const items: PluginResourceItem[] = projects.map((p) => ({
          id: String(p.id),
          name: String(p.name ?? p.id),
          meta: [p.region_id, p.pg_version ? `PG ${p.pg_version}` : null]
            .filter(Boolean)
            .join(' · ') || undefined,
        }));
        if (items.length) {
          groups.push({
            kind: 'projects' as ResourceKind,
            label: 'Projects',
            items,
          });
        }
      } catch {
        // projects optional
      }
      if (!projectId) return groups;
    }

    // --- Branches (name, primary flag, size, state) ---
    let primaryBranch: Rec | undefined;
    try {
      const json = await this.get(apiKey, `/projects/${projectId}/branches`);
      const branches = (json.branches as Rec[]) ?? [];
      primaryBranch =
        branches.find((b) => b.primary || b.default) ?? branches[0];
      const items: PluginResourceItem[] = branches.map((b) => {
        const isPrimary = Boolean(b.primary || b.default);
        const size = b.logical_size as number | undefined;
        const state = (b.current_state as string | undefined) ?? undefined;
        const meta = [
          isPrimary ? 'primary' : null,
          size != null ? bytes(size) : null,
          state,
        ]
          .filter(Boolean)
          .join(' · ');
        return {
          id: String(b.id),
          name: String(b.name ?? b.id),
          state: state === 'ready' ? 'ok' : state === 'init' ? 'warn' : 'idle',
          meta: meta || undefined,
        };
      });
      if (items.length) {
        groups.push({
          kind: 'branches' as ResourceKind,
          label: 'Branches',
          items,
        });
      }
    } catch {
      // branches optional
    }

    const branchId = primaryBranch?.id as string | undefined;

    // --- Compute endpoints (state, autoscaling range, host) ---
    if (branchId) {
      try {
        const json = await this.get(
          apiKey,
          `/projects/${projectId}/branches/${branchId}/endpoints`,
        );
        const endpoints = (json.endpoints as Rec[]) ?? [];
        const items: PluginResourceItem[] = endpoints.map((e) => {
          const state = e.current_state as string | undefined;
          const min = e.autoscaling_limit_min_cu as number | undefined;
          const max = e.autoscaling_limit_max_cu as number | undefined;
          const cu =
            min != null && max != null && min !== max
              ? `${min}–${max} CU`
              : max != null || min != null
                ? `${max ?? min} CU`
                : null;
          const meta = [state, cu, e.type].filter(Boolean).join(' · ');
          return {
            id: String(e.id),
            name: String(e.host ?? e.id),
            state: computeHealth(state),
            meta: meta || undefined,
          };
        });
        if (items.length) {
          groups.push({
            kind: 'computes' as ResourceKind,
            label: 'Compute endpoints',
            items,
          });
        }
      } catch {
        // endpoints optional
      }

      // --- Databases (name, owner) ---
      try {
        const json = await this.get(
          apiKey,
          `/projects/${projectId}/branches/${branchId}/databases`,
        );
        const dbs = (json.databases as Rec[]) ?? [];
        const items: PluginResourceItem[] = dbs.map((d) => ({
          id: String(d.id ?? d.name),
          name: String(d.name),
          meta: d.owner_name ? `owner ${String(d.owner_name)}` : undefined,
        }));
        if (items.length) {
          groups.push({
            kind: 'databases' as ResourceKind,
            label: 'Databases',
            items,
          });
        }
      } catch {
        // databases optional
      }

      // --- Roles ---
      try {
        const json = await this.get(
          apiKey,
          `/projects/${projectId}/branches/${branchId}/roles`,
        );
        const roles = (json.roles as Rec[]) ?? [];
        const items: PluginResourceItem[] = roles.map((r) => ({
          id: String(r.name),
          name: String(r.name),
          meta: r.protected ? 'protected' : undefined,
        }));
        if (items.length) {
          groups.push({
            kind: 'roles' as ResourceKind,
            label: 'Roles',
            items,
          });
        }
      } catch {
        // roles optional
      }
    }

    // --- Operations (recent activity feed: action, status, when) ---
    try {
      const json = await this.get(
        apiKey,
        `/projects/${projectId}/operations?limit=20`,
      );
      const ops = (json.operations as Rec[]) ?? [];
      const items: PluginResourceItem[] = ops.map((op) => ({
        id: String(op.id),
        name: String(op.action ?? 'operation'),
        state: opHealth(op.status as string | undefined),
        meta: [
          op.status ? String(op.status) : null,
          op.created_at ? timeAgo(op.created_at as string) : null,
        ]
          .filter(Boolean)
          .join(' · '),
      }));
      if (items.length) {
        groups.push({
          kind: 'operations' as ResourceKind,
          label: 'Recent operations',
          items,
        });
      }
    } catch {
      // operations optional
    }

    return groups;
  }
}

pluginRegistry.register(new NeonPlugin());
