import { PluginType } from '@prisma/client';
import {
  PluginConfig,
  PluginStatus,
  StackPlugin,
  PluginMetric,
  PluginItem,
  PluginResourceGroup,
  PluginResourceItem,
  HealthState,
} from './plugin.interface';
import { pluginRegistry } from './plugin.registry';

/**
 * Expo (EAS) stack plugin. Connects with an Expo personal access token and
 * talks to the Expo GraphQL API at https://api.expo.dev/graphql (Bearer auth).
 *
 * What it surfaces (honest — only what the GraphQL API returns):
 *  - the account + its apps/projects,
 *  - recent EAS Builds per app (status, platform, commit, when),
 *  - a builds/day sparkline (like Vercel deploys).
 *
 * Expo's schema is app-centric: builds are listed per app via
 * `app.byId(appId).builds(offset, limit, filter)`. We resolve the account (from
 * config.accountName or the token's first account), list its apps, then merge
 * recent builds across the first few apps. Every step is wrapped so a missing
 * scope / plan simply omits data rather than throwing.
 */

const GRAPHQL = 'https://api.expo.dev/graphql';

interface ExpoConfig {
  token: string;
  /** Optional — when omitted we use the token's first account. */
  accountName?: string;
}

type Rec = Record<string, unknown>;

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Map an EAS build status → our normalized health. */
function buildHealth(status?: string): { state: HealthState; label: string } {
  switch (status) {
    case 'FINISHED':
      return { state: 'ok', label: 'Finished' };
    case 'NEW':
    case 'IN_QUEUE':
    case 'IN_PROGRESS':
    case 'PENDING_CANCEL':
      return { state: 'warn', label: 'Building' };
    case 'ERRORED':
      return { state: 'down', label: 'Errored' };
    case 'CANCELED':
      return { state: 'down', label: 'Canceled' };
    default:
      return { state: 'idle', label: status || 'Unknown' };
  }
}

/** iOS / Android / (unknown) short label from the build platform enum. */
function platformLabel(p?: string): string | undefined {
  if (!p) return undefined;
  if (p === 'IOS') return 'iOS';
  if (p === 'ANDROID') return 'Android';
  return p;
}

class ExpoPlugin implements StackPlugin {
  type = PluginType.EXPO;

  private cfg(config: PluginConfig): ExpoConfig {
    return config as unknown as ExpoConfig;
  }

  /** Authed Expo GraphQL POST. Throws on HTTP or GraphQL error. */
  private async gql<T = Rec>(
    c: ExpoConfig,
    query: string,
    variables?: Rec,
  ): Promise<T> {
    const res = await fetch(GRAPHQL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${c.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new Error(`Expo returned ${res.status}`);
    const json = (await res.json()) as { data?: T; errors?: Array<Rec> };
    if (json.errors?.length) {
      const msg = (json.errors[0].message as string) || 'GraphQL error';
      throw new Error(msg);
    }
    if (!json.data) throw new Error('Empty GraphQL response');
    return json.data;
  }

  /** The authenticated actor + the accounts they can see. */
  private async meActor(c: ExpoConfig): Promise<{
    displayName?: string;
    accounts: Array<{ id: string; name: string }>;
  }> {
    const data = await this.gql<{ meActor?: Rec | null }>(
      c,
      `query CitsheMeActor {
        meActor {
          id
          __typename
          ... on UserActor { username fullName }
          ... on Robot { firstName }
          accounts { id name }
        }
      }`,
    );
    const actor = data.meActor ?? {};
    const displayName =
      (actor.username as string) ||
      (actor.fullName as string) ||
      (actor.firstName as string) ||
      undefined;
    const accounts = ((actor.accounts as Array<Rec>) ?? []).map((a) => ({
      id: a.id as string,
      name: a.name as string,
    }));
    return { displayName, accounts };
  }

  /** Resolve the account to inspect (config.accountName or first from token). */
  private async resolveAccount(
    c: ExpoConfig,
    accounts: Array<{ id: string; name: string }>,
  ): Promise<{ id: string; name: string } | undefined> {
    if (c.accountName) {
      const named = accounts.find((a) => a.name === c.accountName);
      if (named) return named;
      // Fall back to a direct byName lookup (token may see it but not list it).
      try {
        const data = await this.gql<{ account?: { byName?: Rec } }>(
          c,
          `query CitsheAccountByName($name: String!) {
            account { byName(accountName: $name) { id name } }
          }`,
          { name: c.accountName },
        );
        const acc = data.account?.byName;
        if (acc?.id) return { id: acc.id as string, name: acc.name as string };
      } catch {
        // ignore — fall through to first
      }
    }
    return accounts[0];
  }

  /** Apps under an account (id/name/slug/fullName + git repo). */
  private async listApps(
    c: ExpoConfig,
    accountName: string,
  ): Promise<Array<Rec>> {
    const data = await this.gql<{ account?: { byName?: Rec } }>(
      c,
      `query CitsheAccountApps($name: String!) {
        account {
          byName(accountName: $name) {
            id
            name
            apps(limit: 100, offset: 0) {
              id
              name
              slug
              fullName
              githubRepository {
                metadata { githubRepoOwnerName githubRepoName }
              }
            }
          }
        }
      }`,
      { name: accountName },
    );
    return (data.account?.byName?.apps as Array<Rec>) ?? [];
  }

  /** Recent builds for one app (newest first). */
  private async appBuilds(
    c: ExpoConfig,
    appId: string,
    limit: number,
  ): Promise<Array<Rec>> {
    const data = await this.gql<{ app?: { byId?: { builds?: Array<Rec> } } }>(
      c,
      `query CitsheAppBuilds($appId: String!, $limit: Int!) {
        app {
          byId(appId: $appId) {
            id
            builds(offset: 0, limit: $limit) {
              id
              status
              platform
              buildProfile
              appVersion
              gitCommitHash
              gitCommitMessage
              createdAt
            }
          }
        }
      }`,
      { appId, limit },
    );
    return (data.app?.byId?.builds as Array<Rec>) ?? [];
  }

  /** Gather recent builds across the first few apps, tagged with app name. */
  private async recentBuilds(
    c: ExpoConfig,
    apps: Array<Rec>,
    perApp: number,
  ): Promise<Array<Rec & { _app?: string }>> {
    const out: Array<Rec & { _app?: string }> = [];
    // Limit the fan-out to keep this cheap — the freshest builds win anyway.
    for (const app of apps.slice(0, 6)) {
      try {
        const builds = await this.appBuilds(c, app.id as string, perApp);
        for (const b of builds) out.push({ ...b, _app: app.name as string });
      } catch {
        // per-app failure — skip that app quietly
      }
    }
    out.sort(
      (a, b) =>
        new Date((b.createdAt as string) || 0).getTime() -
        new Date((a.createdAt as string) || 0).getTime(),
    );
    return out;
  }

  async testConnection(config: PluginConfig) {
    const c = this.cfg(config);
    if (!c.token)
      return { ok: false, error: 'An Expo access token is required.' };
    try {
      const me = await this.meActor(c);
      if (!me.accounts.length && !me.displayName) {
        return {
          ok: false,
          error: 'Token accepted but no account is visible.',
        };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async getStatus(config: PluginConfig): Promise<PluginStatus> {
    const c = this.cfg(config);
    const metrics: PluginMetric[] = [];
    const items: PluginItem[] = [];
    let headline: { label: string; state: HealthState } = {
      label: 'Connected',
      state: 'ok',
    };

    let account: { id: string; name: string } | undefined;

    // --- Account (resilient: omit on failure) ---
    try {
      const me = await this.meActor(c);
      account = await this.resolveAccount(c, me.accounts);
      if (account) {
        metrics.push({
          label: 'Account',
          value: account.name,
          hint: me.displayName || undefined,
          section: 'details',
        });
      } else if (me.displayName) {
        metrics.push({
          label: 'Account',
          value: me.displayName,
          section: 'details',
        });
      }
    } catch {
      // account optional — skip quietly
    }

    // --- Apps + recent builds (the "did my build pass") ---
    if (account) {
      let apps: Array<Rec> = [];
      try {
        apps = await this.listApps(c, account.name);
        metrics.push({
          label: 'Projects',
          value: String(apps.length),
          section: 'details',
        });
      } catch {
        metrics.push({ label: 'Projects', value: 'no access', state: 'warn' });
      }

      if (apps.length) {
        try {
          const builds = await this.recentBuilds(c, apps, 15);
          if (builds.length) {
            const latest = builds[0];
            const h = buildHealth(latest.status as string);
            headline = { label: h.label, state: h.state };
            const plat = platformLabel(latest.platform as string);
            metrics.push({
              label: 'Last build',
              value: `${timeAgo(latest.createdAt as string)} · ${h.label}`,
              hint:
                [latest._app, plat].filter(Boolean).join(' · ') || undefined,
              state: h.state,
              section: 'hero',
            });

            // Builds/day sparkline over the last 14 days (bar, like Vercel).
            let series: number[] | undefined;
            try {
              const DAYS = 14;
              const DAY_MS = 24 * 60 * 60 * 1000;
              const startOfToday = new Date();
              startOfToday.setHours(0, 0, 0, 0);
              const windowStart = startOfToday.getTime() - (DAYS - 1) * DAY_MS;
              const buckets = new Array<number>(DAYS).fill(0);
              for (const b of builds) {
                const t = new Date((b.createdAt as string) || 0).getTime();
                const idx = Math.floor((t - windowStart) / DAY_MS);
                if (idx >= 0 && idx < DAYS) buckets[idx] += 1;
              }
              series = buckets;
            } catch {
              series = undefined;
            }

            metrics.push({
              label: 'Builds (recent)',
              value: String(builds.length),
              section: 'details',
              ...(series ? { series, seriesKind: 'bar' as const } : {}),
            });

            // Build success rate over the fetched window (honest signal).
            const finished = builds.filter(
              (b) => b.status === 'FINISHED',
            ).length;
            const errored = builds.filter(
              (b) => buildHealth(b.status as string).state === 'down',
            ).length;
            if (finished + errored > 0) {
              const rate = Math.round((finished / (finished + errored)) * 100);
              metrics.push({
                label: 'Success rate',
                value: `${rate}%`,
                hint: 'finished vs failed',
                state: rate >= 80 ? 'ok' : rate >= 50 ? 'warn' : 'down',
                section: 'details',
              });
            }
            if (errored) {
              metrics.push({
                label: 'Failed (recent)',
                value: String(errored),
                state: 'down',
                section: 'details',
              });
            }

            for (const b of builds.slice(0, 5)) {
              const bh = buildHealth(b.status as string);
              const plt = platformLabel(b.platform as string);
              const parts = [b._app, plt].filter(Boolean).join(' · ');
              items.push({
                label: parts || (b.buildProfile as string) || 'build',
                value: timeAgo(b.createdAt as string),
                state: bh.state,
              });
            }
          }
        } catch {
          // builds optional — skip quietly
        }
      }
    }

    if (metrics.length === 0) {
      metrics.push({ label: 'Expo', value: 'connected' });
    }

    return {
      type: this.type,
      connected: true,
      headline,
      metrics,
      items: items.length ? items : undefined,
      links: [{ label: 'Open in Expo', url: 'https://expo.dev/accounts' }],
    };
  }

  /** Everything the token can see, grouped — projects + recent builds. */
  async listResources(config: PluginConfig): Promise<PluginResourceGroup[]> {
    const c = this.cfg(config);
    const groups: PluginResourceGroup[] = [];

    let account: { id: string; name: string } | undefined;
    try {
      const me = await this.meActor(c);
      account = await this.resolveAccount(c, me.accounts);
    } catch {
      return groups;
    }
    if (!account) return groups;

    let apps: Array<Rec> = [];

    // --- Projects (slug · git repo) ---
    try {
      apps = await this.listApps(c, account.name);
      const items: PluginResourceItem[] = apps.map((a) => {
        const meta = a.githubRepository as Rec | undefined;
        const gh = (meta?.metadata as Rec | undefined) ?? undefined;
        const repo =
          gh && gh.githubRepoOwnerName
            ? `github:${gh.githubRepoOwnerName as string}/${gh.githubRepoName as string}`
            : undefined;
        const metaParts = [a.slug as string, repo].filter(Boolean) as string[];
        return {
          id: a.id as string,
          name: (a.name as string) || (a.slug as string),
          meta: metaParts.length ? metaParts.join(' · ') : undefined,
        };
      });
      if (items.length)
        groups.push({ kind: 'projects', label: 'Projects', items });
    } catch {
      // projects listing optional — skip quietly
    }

    // --- Builds (profile · platform · commit · when) ---
    if (apps.length) {
      try {
        const builds = await this.recentBuilds(c, apps, 10);
        const items: PluginResourceItem[] = builds.slice(0, 20).map((b) => {
          const bh = buildHealth(b.status as string);
          const plt = platformLabel(b.platform as string);
          const sha = (b.gitCommitHash as string)?.slice(0, 7);
          const commit = (b.gitCommitMessage as string)?.split('\n')[0]?.trim();
          const metaParts = [
            b._app,
            plt,
            b.buildProfile as string,
            sha ? `#${sha}` : undefined,
            b.createdAt ? timeAgo(b.createdAt as string) : undefined,
          ].filter(Boolean) as string[];
          const base = commit || (b.buildProfile as string) || 'build';
          const label = bh.state === 'ok' ? base : `${base} — ${bh.label}`;
          return {
            id: b.id as string,
            name: label,
            state: bh.state,
            meta: metaParts.join(' · ') || undefined,
            branch: undefined,
            sha,
            when: b.createdAt ? timeAgo(b.createdAt as string) : undefined,
          };
        });
        if (items.length)
          groups.push({ kind: 'deployments', label: 'Builds', items });
      } catch {
        // builds listing optional — skip quietly
      }
    }

    return groups;
  }
}

pluginRegistry.register(new ExpoPlugin());
