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

/** Commit author name from a deployment's meta (git) or its creator. */
function commitAuthor(d: Record<string, unknown>): string | undefined {
  const m = (d.meta ?? {}) as Record<string, string>;
  const fromGit =
    m.githubCommitAuthorName ||
    m.gitlabCommitAuthorName ||
    m.bitbucketCommitAuthorName;
  if (fromGit) return fromGit;
  const creator = d.creator as Record<string, unknown> | undefined;
  return (creator?.username as string) || (creator?.email as string) || undefined;
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

  /**
   * Web Analytics daily visits for a project over the last 14 days. Only returns
   * data if the project has Web Analytics enabled; on 403 / error / empty
   * response (the common case — WA off), returns null so nothing is fabricated.
   */
  private async webAnalytics(
    c: VercelConfig,
    projectId: string,
  ): Promise<{ pageviews: number[]; visitors: number[] } | null> {
    try {
      const now = Date.now();
      const since = now - 14 * 24 * 60 * 60 * 1000;
      const path = this.withTeam(
        c,
        `/v1/query/web-analytics/visits/aggregate?projectId=${encodeURIComponent(
          projectId,
        )}&since=${since}&until=${now}&by=day`,
      );
      const res = await fetch(`${API}${path}`, {
        headers: { Authorization: `Bearer ${c.apiToken}` },
      });
      if (!res.ok) return null;
      const json = (await res.json()) as {
        data?: Array<{
          timestamp?: number | string;
          pageviews?: number;
          visitors?: number;
        }>;
      };
      const rows = json?.data ?? [];
      if (!rows.length) return null;
      const pageviews = rows.map((r) => r.pageviews ?? 0);
      const visitors = rows.map((r) => r.visitors ?? 0);
      // Guard against an all-zero / malformed payload masquerading as data.
      if (!pageviews.some((v) => v > 0) && !visitors.some((v) => v > 0)) {
        return null;
      }
      return { pageviews, visitors };
    } catch {
      return null;
    }
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
          metrics.push({
            label: 'Team',
            value: name,
            hint: plan || undefined,
            section: 'details',
          });
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
            section: 'details',
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
      metrics.push({
        label: 'Projects',
        value: String(projects.length),
        section: 'details',
      });

      // Each project carries its latest deployments; rank by createdAt.
      const withDeploy = projects
        .map((p) => {
          const dep = ((p.latestDeployments as Array<Record<string, unknown>>) ??
            [])[0];
          return {
            name: p.name as string,
            project: p,
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
          section: 'hero',
        });

        // --- Details from the current production/first project object ---
        // Prefer the newest production project; else the freshest overall.
        const prodEntry =
          withDeploy.find((p) => p.target === 'production') ?? latest;
        const proj = prodEntry.project;
        const framework = proj.framework as string | undefined;
        if (framework) {
          metrics.push({
            label: 'Framework',
            value: framework,
            section: 'details',
          });
        }
        const nodeVersion = proj.nodeVersion as string | undefined;
        if (nodeVersion) {
          metrics.push({
            label: 'Node version',
            value: nodeVersion,
            section: 'details',
          });
        }
        const repo = repoLabel(proj.link as Record<string, unknown>);
        if (repo) {
          metrics.push({
            label: 'Git repo',
            value: repo,
            section: 'details',
          });
        }
        if (latest.deploymentId) {
          actions.push({
            id: `redeploy:${latest.name}:${latest.deploymentId}`,
            label: 'Redeploy',
            target: latest.name,
            confirm: true,
          });
        }

        // --- Web Analytics (only when the project has WA enabled) ---
        // Conditional/honest: the query returns null on 403/empty (WA off),
        // so these metrics simply don't appear rather than showing fake zeros.
        const projectId = (proj.id as string) || (proj.name as string);
        if (projectId) {
          const wa = await this.webAnalytics(c, projectId);
          if (wa) {
            const totalViews = wa.pageviews.reduce((a, b) => a + b, 0);
            const totalVisitors = wa.visitors.reduce((a, b) => a + b, 0);
            metrics.push({
              label: 'Pageviews',
              value: String(totalViews),
              section: 'usage',
              series: wa.pageviews,
              seriesKind: 'area' as const,
              unit: 'views',
              hint: 'last 14d',
            });
            metrics.push({
              label: 'Visitors',
              value: String(totalVisitors),
              section: 'usage',
              series: wa.visitors,
              seriesKind: 'area' as const,
              hint: 'last 14d',
            });
          }
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
      const json = await this.get(c, '/v6/deployments?limit=100');
      const deployments: Array<Record<string, unknown>> =
        json?.deployments ?? [];
      // Deploys-per-day for the last 14 days (oldest→newest, zero-filled) for a
      // sparkline. Best-effort: omit the series if bucketing fails.
      let deploySeries: number[] | undefined;
      try {
        const DAYS = 14;
        const DAY_MS = 24 * 60 * 60 * 1000;
        // Bucket by local-day boundary so "today" lands in the last slot.
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        const windowStart = startOfToday.getTime() - (DAYS - 1) * DAY_MS;
        const buckets = new Array<number>(DAYS).fill(0);
        for (const d of deployments) {
          const created = d.createdAt as number | undefined;
          if (typeof created !== 'number') continue;
          const idx = Math.floor((created - windowStart) / DAY_MS);
          if (idx >= 0 && idx < DAYS) buckets[idx] += 1;
        }
        deploySeries = buckets;
      } catch {
        deploySeries = undefined;
      }
      metrics.push({
        label: 'Deployments',
        value: String(deployments.length),
        section: 'details',
        ...(deploySeries
          ? { series: deploySeries, seriesKind: 'bar' as const }
          : {}),
      });

      const prod = deployments.filter((d) => d.target === 'production').length;
      if (prod) {
        metrics.push({
          label: 'Production deploys',
          value: String(prod),
          section: 'details',
        });
      }

      const failing = deployments.filter(
        (d) => deployHealth(d.readyState as string).state === 'down',
      ).length;
      if (failing) {
        metrics.push({
          label: 'Failed (recent)',
          value: String(failing),
          state: 'down',
          section: 'details',
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
        section: 'details',
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

  /**
   * The deployment ids currently SERVING production, one per project. Vercel
   * exposes this as project.targets.production.id; we also accept a READY
   * production entry in latestDeployments as a fallback. Resilient: returns an
   * empty set if projects can't be read (so nothing gets falsely marked live).
   */
  private async activeProductionIds(c: VercelConfig): Promise<Set<string>> {
    const ids = new Set<string>();
    try {
      const json = await this.get(c, '/v9/projects?limit=100');
      const projects: Array<Record<string, unknown>> = json?.projects ?? [];
      for (const p of projects) {
        const targets = p.targets as Record<string, unknown> | undefined;
        const prod = targets?.production as Record<string, unknown> | undefined;
        const id = prod?.id as string | undefined;
        if (id) {
          ids.add(id);
          continue;
        }
        // Fallback: newest READY production deployment on the project.
        const latest = (p.latestDeployments as Array<Record<string, unknown>>) ?? [];
        const ready = latest
          .filter(
            (d) => d.target === 'production' && d.readyState === 'READY',
          )
          .sort(
            (a, b) => ((b.createdAt as number) || 0) - ((a.createdAt as number) || 0),
          )[0];
        const uid = ready?.uid as string | undefined;
        if (uid) ids.add(uid);
      }
    } catch {
      // projects unreadable — no active markers rather than wrong ones
    }
    return ids;
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

    // --- Deployments (commit msg · target · branch · sha · when) ---
    // The currently-serving production deployment per project is marked
    // `active` so the UI can pin/badge it as Live. We resolve the active ids
    // from /v9/projects (targets.production.id / a READY production
    // latestDeployment) — resilient: no active flag if projects are unreadable.
    try {
      const activeProdIds = await this.activeProductionIds(c);
      const json = await this.get(c, '/v6/deployments?limit=20');
      const deployments: Array<Record<string, unknown>> =
        json?.deployments ?? [];
      const items = deployments.map((d) => {
        const git = gitMeta(d.meta as Record<string, unknown>);
        const author = commitAuthor(d);
        const env = targetLabel(d.target);
        const when =
          typeof d.createdAt === 'number'
            ? timeAgo(d.createdAt as number)
            : undefined;
        const uid = (d.uid as string) || (d.url as string);
        // Only non-READY states get called out in the meta line — a green dot
        // already says "ready", so we don't repeat it 15 times.
        const stateName = stateLabel(d.readyState as string);
        const metaParts = [
          env,
          git.branch,
          git.sha ? `#${git.sha}` : undefined,
          when,
        ].filter(Boolean) as string[];
        // Lead with the commit message; annotate only non-success states.
        const commit = git.message?.split('\n')[0].trim();
        const health = deployHealth(d.readyState as string).state;
        const baseName =
          commit || (d.name as string) || 'deployment';
        const label =
          health === 'ok'
            ? baseName
            : `${baseName} — ${stateName === 'BUILDING' ? 'Building…' : stateName}`;
        return {
          id: uid,
          name: label,
          state: health,
          meta: metaParts.join(' · ') || undefined,
          active: !!uid && activeProdIds.has(uid),
          environment: env,
          branch: git.branch,
          sha: git.sha,
          author,
          when,
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
