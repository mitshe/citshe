import { PluginType } from '@prisma/client';
import {
  PluginConfig,
  PluginStatus,
  StackPlugin,
  PluginMetric,
  HealthState,
} from './plugin.interface';
import { pluginRegistry } from './plugin.registry';

const API = 'https://console.neon.tech/api/v2';

interface NeonConfig {
  apiKey: string;
  projectId: string;
}

function headers(key: string) {
  return { Authorization: `Bearer ${key}`, Accept: 'application/json' };
}

function bytes(n: number): string {
  const mb = n / (1024 * 1024);
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

/**
 * Neon (Postgres) plugin. Answers "is the DB alive / how big / last active" —
 * the pieces behind "did the migration run, are the data there".
 */
class NeonPlugin implements StackPlugin {
  type = PluginType.NEON;

  private cfg(config: PluginConfig): NeonConfig {
    return config as unknown as NeonConfig;
  }

  async testConnection(config: PluginConfig) {
    const { apiKey, projectId } = this.cfg(config);
    if (!apiKey || !projectId) {
      return { ok: false, error: 'API key and project ID are required.' };
    }
    try {
      const res = await fetch(`${API}/projects/${projectId}`, {
        headers: headers(apiKey),
      });
      if (!res.ok) return { ok: false, error: `Neon returned ${res.status}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async getStatus(config: PluginConfig): Promise<PluginStatus> {
    const { apiKey, projectId } = this.cfg(config);
    const metrics: PluginMetric[] = [];
    let headline: { label: string; state: HealthState } = {
      label: 'OK',
      state: 'ok',
    };

    const proj = await fetch(`${API}/projects/${projectId}`, {
      headers: headers(apiKey),
    }).then((r) => r.json());
    const project = proj?.project;

    if (project?.synthetic_storage_size != null) {
      metrics.push({ label: 'Size', value: bytes(project.synthetic_storage_size) });
    }

    // Branches → default branch name + count.
    try {
      const branchesRes = await fetch(
        `${API}/projects/${projectId}/branches`,
        { headers: headers(apiKey) },
      ).then((r) => r.json());
      const branches = branchesRes?.branches ?? [];
      const primary = branches.find(
        (b: { primary?: boolean; default?: boolean }) => b.primary || b.default,
      );
      if (primary?.name) {
        metrics.push({ label: 'Branch', value: primary.name });
      }
      if (branches.length) {
        metrics.push({ label: 'Branches', value: String(branches.length) });
      }
    } catch {
      // branches optional
    }

    // Recent activity / compute state via operations.
    try {
      const opsRes = await fetch(
        `${API}/projects/${projectId}/operations?limit=1`,
        { headers: headers(apiKey) },
      ).then((r) => r.json());
      const op = opsRes?.operations?.[0];
      if (op?.created_at) {
        metrics.push({ label: 'Last activity', value: timeAgo(op.created_at) });
      }
    } catch {
      // operations optional
    }

    if (metrics.length === 0) {
      headline = { label: 'Connected', state: 'ok' };
      metrics.push({ label: 'Neon', value: 'connected' });
    }

    return {
      type: this.type,
      connected: true,
      headline,
      metrics,
      links: [
        {
          label: 'Open in Neon',
          url: `https://console.neon.tech/app/projects/${projectId}`,
        },
      ],
    };
  }
}

pluginRegistry.register(new NeonPlugin());
