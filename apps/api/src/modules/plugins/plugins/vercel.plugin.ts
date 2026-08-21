import { PluginType } from '@prisma/client';
import {
  PluginConfig,
  PluginStatus,
  StackPlugin,
  PluginMetric,
  PluginItem,
  PluginAction,
  PluginActionResult,
  PluginResourceGroup,
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
  teamId?: string; // optional — for team-scoped tokens
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
    case 'BLOCKED':
      return { state: 'down', label: 'Deploy failed' };
    default:
      return { state: 'idle', label: 'Connected' };
  }
}

/** Short, human label for a deployment readyState (for meta lines). */
function stateLabel(state?: string): string {
  switch (state) {
    case 'READY':
      return 'READY';
    case 'ERROR':
      return 'ERROR';
    case 'CANCELED':
      return 'CANCELED';
    case 'BLOCKED':
      return 'BLOCKED';
    case 'BUILDING':
    case 'QUEUED':
    case 'INITIALIZING':
      return 'BUILDING';
    default:
      return state || 'unknown';
  }
}

/** production | preview label from a deployment's target field (null = preview). */
function targetLabel(target: unknown): string {
  return target === 'production' ? 'production' : 'preview';
}

/** Pull the git commit info out of a deployment/latestDeployment meta blob. */
function gitMeta(meta: Record<string, unknown> | undefined | null): {
  message?: string;
  sha?: string;
  branch?: string;
} {
  const m = (meta ?? {}) as Record<string, string>;
  return {
    message:
      m.githubCommitMessage ||
      m.gitlabCommitMessage ||
      m.bitbucketCommitMessage ||
      undefined,
    sha: (
      m.githubCommitSha ||
      m.gitlabCommitSha ||
      m.bitbucketCommitSha ||
      ''
    ).slice(0, 7) || undefined,
    branch:
      m.githubCommitRef ||
      m.gitlabCommitRef ||
      m.bitbucketCommitRef ||
      m.gitBranch ||
      undefined,
  };
}

/** Describe a project's connected git repo, e.g. "github:acme/site". */
function repoLabel(link: Record<string, unknown> | undefined | null): string | undefined {
  if (!link) return undefined;
  const l = link as Record<string, string>;
  const type = l.type; // github | gitlab | bitbucket
  const repo = l.repo; // "acme/site" or slug depending on provider
  const org = l.org || l.owner;
  if (repo) return type ? `${type}:${repo}` : repo;
  if (org && l.repoId) return `${type || 'git'}:${org}`;
  return type || undefined;
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

  /** Append ?teamId= (as an extra query param) when the token is team-scoped. */
  private withTeam(config: VercelConfig, path: string): string {
    if (!config.teamId) return path;
    const sep = path.includes('?') ? '&' : '?';
    return `${path}${sep}teamId=${encodeURIComponent(config.teamId)}`;
  }

  /** Authed Vercel API GET — Bearer token + optional teamId query param. */
  private async get(config: VercelConfig, path: string) {
    const res = await fetch(`${API}${this.withTeam(config, path)}`, {
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
      const res = await fetch(`${API}${this.withTeam(c, '/v2/user')}`, {
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

    // --- Account / team + plan (resilient: omit on failure) ---
    try {
      if (c.teamId) {
        const json = await this.get(c, '/v2/team');
        const team = (json?.team ?? json) as Record<string, unknown>;
        const name = (team?.name as string) || (team?.slug as string);
        const plan = team?.billing
          ? ((team.billing as Record<string, unknown>).plan as string)
          : undefined;
        if (name) {
          metrics.push({ label: 'Team', value: name, hint: plan || undefined });
        }
      } else {
        const json = await this.get(c, '/v2/user');
        const user = (json?.user ?? {}) as Record<string, unknown>;
        const name =
          (user?.username as string) ||
          (user?.name as string) ||
          (user?.email as string);
        const plan = user?.billing
          ? ((user.billing as Record<string, unknown>).plan as string)
          : undefined;
        if (name) {
          metrics.push({
            label: 'Account',
            value: name,
            hint: plan || undefined,
          });
        }
      }
    } catch {
      // account/team optional — skip quietly
    }

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
            target: dep?.target,
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
          value: `${timeAgo(latest.when)} · ${stateLabel(latest.state)}`,
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

    // --- Recent deployments: total + production count + failure signal ---
    try {
      const json = await this.get(c, '/v6/deployments?limit=20');
      const deployments: Array<Record<string, unknown>> =
        json?.deployments ?? [];
      metrics.push({ label: 'Deployments', value: String(deployments.length) });

      const prod = deployments.filter((d) => d.target === 'production').length;
      if (prod) {
        metrics.push({ label: 'Production deploys', value: String(prod) });
      }

      const failing = deployments.filter(
        (d) => deployHealth(d.readyState as string).state === 'down',
      ).length;
      if (failing) {
        metrics.push({
          label: 'Failed (recent)',
          value: String(failing),
          state: 'down',
        });
      }
    } catch {
      // deployments listing optional — skip quietly
    }

    // --- Domains count + verification signal (resilient: omit on failure) ---
    try {
      const json = await this.get(c, '/v5/domains?limit=100');
      const domains: Array<Record<string, unknown>> = json?.domains ?? [];
      const unverified = domains.filter((d) => d.verified === false).length;
      metrics.push({
        label: 'Domains',
        value: String(domains.length),
        hint: unverified ? `${unverified} unverified` : undefined,
        state: unverified ? 'warn' : undefined,
      });
    } catch {
      // domains listing optional — skip quietly
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
        const res = await fetch(`${API}${this.withTeam(c, '/v13/deployments')}`, {
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

  /** Everything the token can see, grouped — projects, deployments, domains. */
  async listResources(config: PluginConfig): Promise<PluginResourceGroup[]> {
    const c = this.cfg(config);
    const groups: PluginResourceGroup[] = [];

    // --- Projects (framework · last deploy state · git repo) ---
    try {
      const json = await this.get(c, '/v9/projects?limit=100');
      const projects: Array<Record<string, unknown>> = json?.projects ?? [];
      const items = projects.map((p) => {
        const dep = ((p.latestDeployments as Array<Record<string, unknown>>) ??
          [])[0];
        const framework = (p.framework as string) || undefined;
        const repo = repoLabel(p.link as Record<string, unknown>);
        const metaParts = [
          framework,
          repo,
          dep?.createdAt ? timeAgo(dep.createdAt as number) : undefined,
        ].filter(Boolean) as string[];
        return {
          id: (p.id as string) || (p.name as string),
          name: p.name as string,
          state: dep ? deployHealth(dep.readyState as string).state : 'idle',
          meta: metaParts.length ? metaParts.join(' · ') : undefined,
        };
      });
      if (items.length)
        groups.push({ kind: 'projects', label: 'Projects', items });
    } catch {
      // projects listing optional — skip quietly
    }

    // --- Deployments (target · commit msg + sha · branch · when) ---
    try {
      const json = await this.get(c, '/v6/deployments?limit=20');
      const deployments: Array<Record<string, unknown>> =
        json?.deployments ?? [];
      const items = deployments.map((d) => {
        const git = gitMeta(d.meta as Record<string, unknown>);
        const when =
          typeof d.createdAt === 'number'
            ? timeAgo(d.createdAt as number)
            : undefined;
        const metaParts = [
          targetLabel(d.target),
          stateLabel(d.readyState as string),
          git.branch,
          git.sha ? `#${git.sha}` : undefined,
          when,
        ].filter(Boolean) as string[];
        const label = git.message
          ? `${(d.name as string) || 'deployment'} — ${git.message.split('\n')[0].slice(0, 60)}`
          : (d.name as string) || 'deployment';
        return {
          id: (d.uid as string) || (d.url as string),
          name: label,
          state: deployHealth(d.readyState as string).state,
          meta: metaParts.join(' · '),
        };
      });
      if (items.length)
        groups.push({ kind: 'deployments', label: 'Deployments', items });
    } catch {
      // deployments listing optional — skip quietly
    }

    // --- Domains (verified/unverified · nameserver service) ---
    try {
      const json = await this.get(c, '/v5/domains?limit=100');
      const domains: Array<Record<string, unknown>> = json?.domains ?? [];
      const items = domains.map((d) => {
        const verified = d.verified === true;
        const metaParts = [
          verified ? 'verified' : 'unverified',
          (d.serviceType as string) || undefined,
        ].filter(Boolean) as string[];
        return {
          id: d.name as string,
          name: d.name as string,
          state: (verified ? 'ok' : 'warn') as HealthState,
          meta: metaParts.join(' · '),
        };
      });
      if (items.length)
        groups.push({ kind: 'domains', label: 'Domains', items });
    } catch {
      // domains listing optional — skip quietly
    }

    return groups;
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
          const git = gitMeta(d.meta as Record<string, unknown>);
          const state = deployHealth(d.readyState as string);
          return {
            url: `https://${d.url as string}`,
            branch: git.branch,
            commit: git.sha,
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
