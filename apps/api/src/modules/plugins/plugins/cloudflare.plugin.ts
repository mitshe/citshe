import { PluginType } from '@prisma/client';
import {
  PluginConfig,
  PluginStatus,
  StackPlugin,
  PluginMetric,
  HealthState,
} from './plugin.interface';
import { pluginRegistry } from './plugin.registry';

const API = 'https://api.cloudflare.com/client/v4';

interface CfConfig {
  apiToken: string;
  accountId: string;
  pagesProject?: string;
  r2Bucket?: string;
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

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

/**
 * Cloudflare stack plugin: the hosting layer. Answers "is it on prod / when did
 * it deploy / what's on R2" from Cloudflare's API v4 — read-only.
 */
class CloudflarePlugin implements StackPlugin {
  type = PluginType.CLOUDFLARE;

  private cfg(config: PluginConfig): CfConfig {
    return config as unknown as CfConfig;
  }

  async testConnection(config: PluginConfig) {
    const { apiToken, accountId } = this.cfg(config);
    if (!apiToken || !accountId) {
      return { ok: false, error: 'API token and account ID are required.' };
    }
    try {
      const res = await fetch(`${API}/accounts/${accountId}`, {
        headers: cfHeaders(apiToken),
      });
      if (!res.ok) {
        return { ok: false, error: `Cloudflare returned ${res.status}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async getStatus(config: PluginConfig): Promise<PluginStatus> {
    const { apiToken, accountId, pagesProject, r2Bucket } = this.cfg(config);
    const metrics: PluginMetric[] = [];
    let headline: { label: string; state: HealthState } = {
      label: 'Connected',
      state: 'ok',
    };

    // --- Pages: latest deployment (the "is it live" signal) ---
    if (pagesProject) {
      try {
        const res = await fetch(
          `${API}/accounts/${accountId}/pages/projects/${pagesProject}/deployments?per_page=1`,
          { headers: cfHeaders(apiToken) },
        );
        const json = await res.json();
        const dep = json?.result?.[0];
        if (dep) {
          const stage = dep.latest_stage?.status || dep.deployment_trigger?.type;
          const ok = stage === 'success' || stage === 'active';
          const building = stage === 'building' || stage === 'queued';
          headline = {
            label: ok ? 'Live' : building ? 'Deploying' : 'Deploy failed',
            state: ok ? 'ok' : building ? 'warn' : 'down',
          };
          const commit =
            dep.deployment_trigger?.metadata?.commit_hash?.slice(0, 7);
          const branch = dep.deployment_trigger?.metadata?.branch;
          metrics.push({
            label: 'Last deploy',
            value: timeAgo(dep.created_on),
            hint: [branch, commit].filter(Boolean).join('@') || undefined,
            state: ok ? 'ok' : building ? 'warn' : 'down',
          });
        } else {
          metrics.push({ label: 'Deploy', value: 'no deployments' });
        }
      } catch {
        metrics.push({ label: 'Pages', value: 'unavailable', state: 'warn' });
      }
    }

    // --- R2: bucket presence + size ("is the file on R2") ---
    if (r2Bucket) {
      try {
        const res = await fetch(
          `${API}/accounts/${accountId}/r2/buckets/${r2Bucket}/usage`,
          { headers: cfHeaders(apiToken) },
        );
        const json = await res.json();
        const usage = json?.result;
        if (usage) {
          metrics.push({
            label: 'R2',
            value: bytes(usage.payloadSize ?? usage.metadataSize ?? 0),
            hint: usage.objectCount ? `${usage.objectCount} objects` : undefined,
          });
        }
      } catch {
        metrics.push({ label: 'R2', value: 'unavailable', state: 'warn' });
      }
    }

    if (metrics.length === 0) {
      metrics.push({
        label: 'Cloudflare',
        value: 'connected',
        hint: 'add a Pages project / R2 bucket to see status',
      });
    }

    return {
      type: this.type,
      connected: true,
      headline,
      metrics,
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
