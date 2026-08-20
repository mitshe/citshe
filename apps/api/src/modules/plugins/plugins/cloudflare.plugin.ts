import { PluginType } from '@prisma/client';
import {
  PluginConfig,
  PluginStatus,
  StackPlugin,
  PluginMetric,
  PluginItem,
  HealthState,
} from './plugin.interface';
import { pluginRegistry } from './plugin.registry';

const API = 'https://api.cloudflare.com/client/v4';

interface CfConfig {
  apiToken: string;
  accountId?: string; // optional — auto-detected from the token if absent
}

function cfHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
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

/**
 * Cloudflare stack plugin. Connect with just an API token — citshe discovers
 * everything the token can see (Pages projects, R2 buckets, Workers). No manual
 * "type one bucket name" — you have access to all of it, so we list all of it.
 */
class CloudflarePlugin implements StackPlugin {
  type = PluginType.CLOUDFLARE;

  private cfg(config: PluginConfig): CfConfig {
    return config as unknown as CfConfig;
  }

  private async get(token: string, path: string) {
    const res = await fetch(`${API}${path}`, { headers: cfHeaders(token) });
    if (!res.ok) throw new Error(`Cloudflare returned ${res.status}`);
    return res.json();
  }

  /** Resolve the account id — explicit, else the first account the token sees. */
  private async resolveAccount(config: CfConfig): Promise<string> {
    if (config.accountId) return config.accountId;
    const json = await this.get(config.apiToken, '/accounts');
    const acc = json?.result?.[0];
    if (!acc?.id) throw new Error('No accounts visible to this token.');
    return acc.id as string;
  }

  async testConnection(config: PluginConfig) {
    const { apiToken } = this.cfg(config);
    if (!apiToken) return { ok: false, error: 'An API token is required.' };
    try {
      // Token is valid if it can list at least one account.
      const json = await this.get(apiToken, '/accounts');
      if (!json?.result?.length) {
        return { ok: false, error: 'Token has no account access.' };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async getStatus(config: PluginConfig): Promise<PluginStatus> {
    const { apiToken } = this.cfg(config);
    const accountId = await this.resolveAccount(this.cfg(config));

    const metrics: PluginMetric[] = [];
    const items: PluginItem[] = [];
    let headline: { label: string; state: HealthState } = {
      label: 'Connected',
      state: 'ok',
    };

    // --- Pages: all projects + the freshest deployment (the "is it live") ---
    try {
      const json = await this.get(
        apiToken,
        `/accounts/${accountId}/pages/projects`,
      );
      const projects: Array<Record<string, unknown>> = json?.result ?? [];
      metrics.push({ label: 'Pages projects', value: String(projects.length) });

      // Rank by latest deployment time and surface the top few.
      const withDeploy = projects
        .map((p) => {
          const dep = (p.latest_deployment ?? {}) as Record<string, unknown>;
          const stage = (dep.latest_stage as { status?: string })?.status;
          return {
            name: p.name as string,
            when: (dep.created_on as string) || '',
            stage,
          };
        })
        .filter((p) => p.when)
        .sort((a, b) => +new Date(b.when) - +new Date(a.when));

      const latest = withDeploy[0];
      if (latest) {
        const ok = latest.stage === 'success' || latest.stage === 'active';
        const building = latest.stage === 'building' || latest.stage === 'queued';
        headline = {
          label: ok ? 'Live' : building ? 'Deploying' : 'Deploy failed',
          state: ok ? 'ok' : building ? 'warn' : 'down',
        };
        metrics.push({
          label: 'Last deploy',
          value: timeAgo(latest.when),
          hint: latest.name,
          state: ok ? 'ok' : building ? 'warn' : 'down',
        });
      }

      for (const p of withDeploy.slice(0, 5)) {
        const ok = p.stage === 'success' || p.stage === 'active';
        const building = p.stage === 'building' || p.stage === 'queued';
        items.push({
          label: p.name,
          value: timeAgo(p.when),
          state: ok ? 'ok' : building ? 'warn' : 'down',
        });
      }
    } catch {
      metrics.push({ label: 'Pages', value: 'no access', state: 'warn' });
    }

    // --- R2: how many buckets (you have them all, so we count them all) ---
    try {
      const json = await this.get(
        apiToken,
        `/accounts/${accountId}/r2/buckets`,
      );
      const buckets: Array<Record<string, unknown>> = json?.result?.buckets ?? [];
      metrics.push({ label: 'R2 buckets', value: String(buckets.length) });
    } catch {
      // R2 may be off / token lacks scope — skip quietly.
    }

    // --- Workers: how many scripts ---
    try {
      const json = await this.get(
        apiToken,
        `/accounts/${accountId}/workers/scripts`,
      );
      const scripts: Array<unknown> = json?.result ?? [];
      if (scripts.length) {
        metrics.push({ label: 'Workers', value: String(scripts.length) });
      }
    } catch {
      // optional
    }

    if (metrics.length === 0) {
      metrics.push({ label: 'Cloudflare', value: 'connected' });
    }

    return {
      type: this.type,
      connected: true,
      headline,
      metrics,
      items: items.length ? items : undefined,
      links: [
        {
          label: 'Open in Cloudflare',
          url: `https://dash.cloudflare.com/${accountId}`,
        },
      ],
    };
  }
}

pluginRegistry.register(new CloudflarePlugin());
