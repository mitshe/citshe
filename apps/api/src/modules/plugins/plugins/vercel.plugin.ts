import { PluginType } from '@prisma/client';
import {
  PluginConfig,
  PluginStatus,
  StackPlugin,
  PluginMetric,
  PluginItem,
  PluginAction,
  PluginActionResult,
  PreviewDeployment,
  HealthState,
} from './plugin.interface';
import { pluginRegistry } from './plugin.registry';

/** Fuzzy match a repo name to a Vercel project name. */
function nameMatches(project: string, repo?: string): boolean {
  if (!repo) return true;
  const norm = (s: string) => s.toLowerCase().replace(/[-_.]/g, '');
  const p = norm(project);
  const r = norm(repo.split('/').pop() || repo);
  return p.includes(r) || r.includes(p);
}

const API = 'https://api.vercel.com';

interface VercelConfig {
  apiToken: string;
  teamId?: string; // optional — for team-scoped tokens; personal if absent
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Map Vercel deployment readyState → our normalized health. */
function deployHealth(state?: string): { state: HealthState; label: string } {
  switch (state) {
    case 'READY':
      return { state: 'ok', label: 'Live' };
    case 'BUILDING':
    case 'QUEUED':
    case 'INITIALIZING':
      return { state: 'warn', label: 'Deploying' };
    case 'ERROR':
    case 'CANCELED':
      return { state: 'down', label: 'Deploy failed' };
    default:
      return { state: 'idle', label: 'Connected' };
  }
}

/**
 * Vercel stack plugin. Connect with just an API token — citshe discovers the
 * projects the token can see and surfaces the freshest deployment (the "is it
 * live"). Mirrors the Cloudflare plugin: one token, list everything you have.
 */
class VercelPlugin implements StackPlugin {
  type = PluginType.VERCEL;

  private cfg(config: PluginConfig): VercelConfig {
    return config as unknown as VercelConfig;
  }

  /** Adds ?teamId=... when the token is team-scoped. */
  private q(config: VercelConfig, path: string): string {
    if (!config.teamId) return path;
    return path.includes('?')
      ? `${path}&teamId=${config.teamId}`
      : `${path}?teamId=${config.teamId}`;
  }

  private async get(config: VercelConfig, path: string) {
    const res = await fetch(`${API}${this.q(config, path)}`, {
      headers: { Authorization: `Bearer ${config.apiToken}` },
    });
    if (!res.ok) throw new Error(`Vercel returned ${res.status}`);
    return res.json();
  }

  async testConnection(config: PluginConfig) {
    const c = this.cfg(config);
    if (!c.apiToken) return { ok: false, error: 'An API token is required.' };
    try {
      // Token is valid if it can read the current user.
      const res = await fetch(`${API}/v2/user`, {
        headers: { Authorization: `Bearer ${c.apiToken}` },
      });
      if (!res.ok) return { ok: false, error: `Token rejected (${res.status}).` };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async getStatus(config: PluginConfig): Promise<PluginStatus> {
    const c = this.cfg(config);
    const metrics: PluginMetric[] = [];
    const items: PluginItem[] = [];
    const actions: PluginAction[] = [];
    let headline: { label: string; state: HealthState } = {
      label: 'Connected',
      state: 'ok',
    };

    // --- Projects + freshest deployment per project (the "is it live") ---
    try {
      const json = await this.get(c, '/v9/projects?limit=100');
      const projects: Array<Record<string, unknown>> = json?.projects ?? [];
      metrics.push({ label: 'Projects', value: String(projects.length) });

      // Each project carries its latest deployments; rank by createdAt.
      const withDeploy = projects
        .map((p) => {
          const dep = ((p.latestDeployments as Array<Record<string, unknown>>) ??
            [])[0];
          return {
            name: p.name as string,
            when: (dep?.createdAt as number) || 0,
            state: dep?.readyState as string | undefined,
            deploymentId: dep?.uid as string | undefined,
          };
        })
        .filter((p) => p.when)
        .sort((a, b) => b.when - a.when);

      const latest = withDeploy[0];
      if (latest) {
        const h = deployHealth(latest.state);
        headline = { label: h.label, state: h.state };
        metrics.push({
          label: 'Last deploy',
          value: timeAgo(latest.when),
          hint: latest.name,
          state: h.state,
        });
        if (latest.deploymentId) {
          actions.push({
            id: `redeploy:${latest.name}:${latest.deploymentId}`,
            label: 'Redeploy',
            target: latest.name,
            confirm: true,
          });
        }
      }

      for (const p of withDeploy.slice(0, 5)) {
        const h = deployHealth(p.state);
        items.push({ label: p.name, value: timeAgo(p.when), state: h.state });
      }
    } catch {
      metrics.push({ label: 'Projects', value: 'no access', state: 'warn' });
    }

    if (metrics.length === 0) {
      metrics.push({ label: 'Vercel', value: 'connected' });
    }

    return {
      type: this.type,
      connected: true,
      headline,
      metrics,
      items: items.length ? items : undefined,
      actions: actions.length ? actions : undefined,
      links: [{ label: 'Open in Vercel', url: 'https://vercel.com/dashboard' }],
    };
  }

  /** Write-actions: redeploy a project's latest deployment. */
  async runAction(
    config: PluginConfig,
    actionId: string,
  ): Promise<PluginActionResult> {
    const c = this.cfg(config);
    if (actionId.startsWith('redeploy:')) {
      const [, name, deploymentId] = actionId.split(':');
      if (!name || !deploymentId) {
        return { ok: false, message: 'Nothing to redeploy.' };
      }
      try {
        const res = await fetch(`${API}${this.q(c, '/v13/deployments')}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${c.apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name,
            deploymentId,
            target: 'production',
          }),
        });
        if (!res.ok) {
          const body = await res.text();
          return { ok: false, message: `Vercel ${res.status}: ${body.slice(0, 120)}` };
        }
        return { ok: true, message: `Redeploying ${name}…` };
      } catch (err) {
        return { ok: false, message: (err as Error).message };
      }
    }
    return { ok: false, message: `Unknown action: ${actionId}` };
  }

  /** Recent PREVIEW deployments (target !== production) for a repo's project. */
  async listPreviews(
    config: PluginConfig,
    repoName?: string,
  ): Promise<PreviewDeployment[]> {
    const c = this.cfg(config);
    try {
      const json = await this.get(c, '/v6/deployments?limit=30');
      const deployments: Array<Record<string, unknown>> =
        json?.deployments ?? [];
      return deployments
        .filter((d) => (d.target ?? 'preview') !== 'production')
        .filter((d) => nameMatches((d.name as string) || '', repoName))
        .slice(0, 8)
        .map((d) => {
          const meta = (d.meta ?? {}) as Record<string, string>;
          const state = deployHealth(d.readyState as string);
          return {
            url: `https://${d.url as string}`,
            branch: meta.githubCommitRef || meta.gitBranch,
            commit: (meta.githubCommitSha || '').slice(0, 7) || undefined,
            when: d.createdAt
              ? new Date(d.createdAt as number).toISOString()
              : undefined,
            state: state.state,
            project: d.name as string,
            provider: 'vercel' as const,
          };
        });
    } catch {
      return [];
    }
  }
}

pluginRegistry.register(new VercelPlugin());
