import { PluginType } from '@prisma/client';
import {
  PluginConfig,
  PluginStatus,
  StackPlugin,
  PluginMetric,
  PluginItem,
  PluginAction,
  PluginActionResult,
  PluginWarning,
  PreviewDeployment,
  PluginResourceGroup,
  PluginResourceItem,
  PluginSelection,
  HealthState,
} from './plugin.interface';
import { pluginRegistry } from './plugin.registry';

/**
 * Fuzzy match a repo name to a Cloudflare resource name (project/zone/worker/
 * bucket). Ignores separators/case. Matches when either normalized name contains
 * the other (e.g. repo "dronexamine-com" ↔ zone "dronexamine.com"), OR when they
 * share the same brand token — the first separator-delimited word (e.g. repo
 * "maistero-com" ↔ bucket "maistero-main", zone "maistero.com" — all "maistero").
 * The brand token must be reasonably distinctive (≥4 chars) so short generic
 * prefixes like "app-" or "web-" don't over-match across unrelated portals.
 */
function nameMatches(project: string, repo?: string): boolean {
  if (!repo) return true;
  const norm = (s: string) => s.toLowerCase().replace(/[-_.]/g, '');
  const p = norm(project);
  const r = norm(repo.split('/').pop() || repo);
  if (p.includes(r) || r.includes(p)) return true;
  // Brand token = first word before any separator, from the repo's basename.
  const brand = (repo.split('/').pop() || repo).toLowerCase().split(/[-_.]/)[0];
  const projBrand = project.toLowerCase().split(/[-_.]/)[0];
  return brand.length >= 4 && brand === projBrand;
}

const API = 'https://api.cloudflare.com/client/v4';

interface CfConfig {
  apiToken: string;
  accountId?: string; // optional — auto-detected from the token if absent
  selection?: PluginSelection; // per-portal: which resources to show
  scopeRepos?: string[]; // this portal's repo names — scope resources to them
}

/** Does a resource name belong to this portal (matches any of its repos)? */
function inScope(name: string, scopeRepos?: string[]): boolean {
  if (!scopeRepos || scopeRepos.length === 0) return true; // unscoped → show all
  return scopeRepos.some((repo) => nameMatches(name, repo));
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

/** Compact a request/record count: 1234 → 1.2k, 3400000 → 3.4M. */
function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${(n / 1_000_000_000).toFixed(1)}B`;
}

/** Bytes → human-readable (KB/MB/GB/TB), matching a bandwidth readout. */
function humanBytes(n: number): string {
  if (n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(n) / Math.log(1024)),
  );
  const v = n / Math.pow(1024, i);
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** ISO for the start of the last-24h window (GraphQL date/datetime filters). */
function since24h(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
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

  /**
   * Count records without paging them all: the list endpoints return
   * `result_info.total_count`, so a single `per_page=1` call is enough.
   */
  private async countVia(token: string, path: string): Promise<number> {
    const sep = path.includes('?') ? '&' : '?';
    const json = await this.get(token, `${path}${sep}per_page=1`);
    const info = json?.result_info as { total_count?: number } | undefined;
    if (typeof info?.total_count === 'number') return info.total_count;
    // Fallback: length of whatever came back (some endpoints omit result_info).
    const r = json?.result;
    return Array.isArray(r) ? r.length : 0;
  }

  /**
   * Last-24h traffic for a single zone via the GraphQL analytics API
   * (httpRequests1dGroups). Resilient: returns null if the token lacks the
   * Analytics scope, the dataset is empty, or the query errors.
   */
  private async zoneTraffic(
    token: string,
    zoneTag: string,
  ): Promise<{
    requests: number;
    bytes: number;
    cachedRequests: number;
    threats: number;
  } | null> {
    const query = `query ($zoneTag: String!, $since: String!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequests1dGroups(
            limit: 7
            filter: { date_geq: $since }
            orderBy: [date_ASC]
          ) {
            sum { requests bytes cachedRequests threats }
          }
        }
      }
    }`;
    try {
      const res = await fetch(`${API}/graphql`, {
        method: 'POST',
        headers: cfHeaders(token),
        body: JSON.stringify({
          query,
          variables: { zoneTag, since: since24h().slice(0, 10) },
        }),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as {
        errors?: unknown[];
        data?: {
          viewer?: {
            zones?: Array<{
              httpRequests1dGroups?: Array<{
                sum?: {
                  requests?: number;
                  bytes?: number;
                  cachedRequests?: number;
                  threats?: number;
                };
              }>;
            }>;
          };
        };
      };
      if (json.errors?.length) return null;
      const groups = json.data?.viewer?.zones?.[0]?.httpRequests1dGroups ?? [];
      if (!groups.length) return null;
      const acc = { requests: 0, bytes: 0, cachedRequests: 0, threats: 0 };
      for (const g of groups) {
        acc.requests += g.sum?.requests ?? 0;
        acc.bytes += g.sum?.bytes ?? 0;
        acc.cachedRequests += g.sum?.cachedRequests ?? 0;
        acc.threats += g.sum?.threats ?? 0;
      }
      return acc;
    } catch {
      return null;
    }
  }

  /**
   * Hourly traffic series for the last 24h via the GraphQL analytics API
   * (httpRequests1hGroups). Returns per-hour arrays (oldest→newest) so the UI
   * can draw sparklines. Beyond total requests/bytes this also breaks requests
   * down by HTTP status class (2xx/3xx/4xx/5xx) and returns hourly cached
   * requests so callers can plot a cache-hit-rate line. Resilient: returns
   * null on any failure (missing Analytics scope, empty dataset, query error).
   */
  private async zoneTrafficSeries(
    token: string,
    zoneTag: string,
  ): Promise<{
    requests: number[];
    bytes: number[];
    cached: number[];
    status: { s2xx: number[]; s3xx: number[]; s4xx: number[]; s5xx: number[] };
    labels: string[];
  } | null> {
    const now = new Date();
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const query = `query ($zoneTag: String!, $since: String!, $until: String!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequests1hGroups(
            limit: 24
            filter: { datetime_geq: $since, datetime_lt: $until }
            orderBy: [datetime_ASC]
          ) {
            dimensions { datetime }
            sum {
              requests
              bytes
              cachedRequests
              responseStatusMap { edgeResponseStatus requests }
            }
          }
        }
      }
    }`;
    try {
      const res = await fetch(`${API}/graphql`, {
        method: 'POST',
        headers: cfHeaders(token),
        body: JSON.stringify({
          query,
          variables: {
            zoneTag,
            since: since.toISOString(),
            until: now.toISOString(),
          },
        }),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as {
        errors?: unknown[];
        data?: {
          viewer?: {
            zones?: Array<{
              httpRequests1hGroups?: Array<{
                dimensions?: { datetime?: string };
                sum?: {
                  requests?: number;
                  bytes?: number;
                  cachedRequests?: number;
                  responseStatusMap?: Array<{
                    edgeResponseStatus?: number;
                    requests?: number;
                  }>;
                };
              }>;
            }>;
          };
        };
      };
      if (json.errors?.length) return null;
      const groups = json.data?.viewer?.zones?.[0]?.httpRequests1hGroups ?? [];
      if (!groups.length) return null;
      const requests = groups.map((g) => g.sum?.requests ?? 0);
      const bytes = groups.map((g) => g.sum?.bytes ?? 0);
      const cached = groups.map((g) => g.sum?.cachedRequests ?? 0);
      const s2xx: number[] = [];
      const s3xx: number[] = [];
      const s4xx: number[] = [];
      const s5xx: number[] = [];
      for (const g of groups) {
        let b2 = 0,
          b3 = 0,
          b4 = 0,
          b5 = 0;
        for (const s of g.sum?.responseStatusMap ?? []) {
          const code = s.edgeResponseStatus ?? 0;
          const n = s.requests ?? 0;
          if (code >= 200 && code < 300) b2 += n;
          else if (code >= 300 && code < 400) b3 += n;
          else if (code >= 400 && code < 500) b4 += n;
          else if (code >= 500 && code < 600) b5 += n;
        }
        s2xx.push(b2);
        s3xx.push(b3);
        s4xx.push(b4);
        s5xx.push(b5);
      }
      // Hour labels: "24h" … "1h" … "now" (oldest→newest).
      const labels = groups.map((_, i) => {
        const back = groups.length - 1 - i;
        return back === 0 ? 'now' : `${back}h`;
      });
      return {
        requests,
        bytes,
        cached,
        status: { s2xx, s3xx, s4xx, s5xx },
        labels,
      };
    } catch {
      return null;
    }
  }

  /**
   * Hourly Workers invocations for the last 24h via the GraphQL analytics API
   * (workersInvocationsAdaptive), aggregated across all scripts per hour.
   * Returns per-hour requests/errors arrays (oldest→newest). Resilient:
   * returns null if the account has no Workers, the token lacks scope, or the
   * query errors.
   */
  private async workersSeries(
    token: string,
    accountTag: string,
  ): Promise<{ requests: number[]; errors: number[] } | null> {
    const now = new Date();
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const query = `query ($accountTag: String!, $since: Time!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          workersInvocationsAdaptive(
            limit: 1000
            filter: { datetime_geq: $since }
            orderBy: [datetime_ASC]
          ) {
            dimensions { datetime }
            sum { requests errors }
          }
        }
      }
    }`;
    try {
      const res = await fetch(`${API}/graphql`, {
        method: 'POST',
        headers: cfHeaders(token),
        body: JSON.stringify({
          query,
          variables: { accountTag, since: since.toISOString() },
        }),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as {
        errors?: unknown[];
        data?: {
          viewer?: {
            accounts?: Array<{
              workersInvocationsAdaptive?: Array<{
                dimensions?: { datetime?: string };
                sum?: { requests?: number; errors?: number };
              }>;
            }>;
          };
        };
      };
      if (json.errors?.length) return null;
      const rows =
        json.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive ?? [];
      if (!rows.length) return null;
      // Bucket by hour across all scripts (rows may be per-script per-hour).
      const buckets = new Map<string, { requests: number; errors: number }>();
      for (const r of rows) {
        const dt = r.dimensions?.datetime;
        if (!dt) continue;
        // Truncate to the hour so multiple scripts share a bucket.
        const key = dt.slice(0, 13);
        const b = buckets.get(key) ?? { requests: 0, errors: 0 };
        b.requests += r.sum?.requests ?? 0;
        b.errors += r.sum?.errors ?? 0;
        buckets.set(key, b);
      }
      const keys = [...buckets.keys()].sort();
      if (!keys.length) return null;
      const requests = keys.map((k) => buckets.get(k)!.requests);
      const errors = keys.map((k) => buckets.get(k)!.errors);
      return { requests, errors };
    } catch {
      return null;
    }
  }

  /** Resolve the account id — explicit, else the first account the token sees. */
  private async resolveAccount(config: CfConfig): Promise<string> {
    if (config.accountId) return config.accountId;
    const json = await this.get(config.apiToken, '/accounts');
    const acc = json?.result?.[0];
    if (!acc?.id) throw new Error('No accounts visible to this token.');
    return acc.id as string;
  }

  /** Everything the token can see, grouped — for the resource picker. */
  async listResources(config: PluginConfig): Promise<PluginResourceGroup[]> {
    const { apiToken } = this.cfg(config);
    const accountId = await this.resolveAccount(this.cfg(config));
    const groups: PluginResourceGroup[] = [];

    const safeList = async (
      path: string,
      map: (r: Record<string, unknown>) => PluginResourceItem,
      pick: (json: Record<string, unknown>) => Array<Record<string, unknown>>,
    ): Promise<PluginResourceItem[]> => {
      try {
        const json = await this.get(apiToken, path);
        return pick(json).map(map);
      } catch {
        return [];
      }
    };

    // Pages: each project annotated with its latest deploy state + when. Keep
    // the raw project objects too — we need canonical_deployment below to mark
    // the live production deploy.
    const scopeRepos = this.cfg(config).scopeRepos;
    let pagesRaw: Array<Record<string, unknown>> = [];
    try {
      const pj = await this.get(
        apiToken,
        `/accounts/${accountId}/pages/projects`,
      );
      pagesRaw = (pj?.result as Array<Record<string, unknown>>) ?? [];
      // Scope to THIS portal's project(s) so we don't list the whole account.
      pagesRaw = pagesRaw.filter((p) =>
        inScope(String(p.name ?? ''), scopeRepos),
      );
    } catch {
      pagesRaw = [];
    }
    const pages: PluginResourceItem[] = pagesRaw.map((p) => {
      const dep = (p.latest_deployment ?? {}) as Record<string, unknown>;
      const stage = (dep.latest_stage as { status?: string })?.status;
      const when = dep.created_on as string | undefined;
      const ok = stage === 'success' || stage === 'active';
      const building = stage === 'building' || stage === 'queued';
      return {
        id: p.name as string,
        name: p.name as string,
        state: (stage
          ? ok
            ? 'ok'
            : building
              ? 'warn'
              : 'down'
          : 'idle') as HealthState,
        meta: when ? timeAgo(when) : undefined,
      };
    });
    if (pages.length)
      groups.push({ kind: 'pages', label: 'Pages', items: pages });

    // Recent deployments across the freshest Pages project (rich: state +
    // commit message + branch + author + relative time). The live production
    // deploy — the project's canonical/latest deployment, or failing that the
    // newest production+success one — is marked `active`. Best-effort.
    try {
      const projObj = pagesRaw.find(
        (p) => (p.name as string) === pages[0]?.name,
      );
      const proj = pages[0]?.name;
      if (proj) {
        // Cloudflare exposes the currently-served production deploy as the
        // project's canonical_deployment (fallback: latest_deployment).
        const canonical =
          (projObj?.canonical_deployment as Record<string, unknown>)?.id ??
          (projObj?.latest_deployment as Record<string, unknown>)?.id;
        const dj = await this.get(
          apiToken,
          `/accounts/${accountId}/pages/projects/${proj}/deployments?per_page=15`,
        );
        const deploys: Array<Record<string, unknown>> = dj?.result ?? [];
        // Fallback active id: newest production+success deployment.
        let fallbackActiveId: string | undefined;
        if (!canonical) {
          const liveProd = deploys.find(
            (d) =>
              ((d.environment as string) || 'production') === 'production' &&
              (d.latest_stage as { status?: string })?.status === 'success',
          );
          fallbackActiveId = liveProd?.id as string | undefined;
        }
        const activeId = (canonical as string) || fallbackActiveId;
        const items: PluginResourceItem[] = deploys.map((d) => {
          const stage = (d.latest_stage as { status?: string })?.status;
          const ok = stage === 'success';
          const building = stage === 'building' || stage === 'queued';
          const trig = (d.deployment_trigger as Record<string, unknown>) ?? {};
          const meta = (trig.metadata as Record<string, unknown>) ?? {};
          const sha = (meta.commit_hash as string)?.slice(0, 7);
          const branch = (meta.branch as string) || undefined;
          const author = (meta.author as string) || undefined;
          const message = (meta.commit_message as string)
            ?.split('\n')[0]
            .trim();
          const env = (d.environment as string) || 'production';
          const whenIso = d.created_on as string | undefined;
          const when = whenIso ? timeAgo(whenIso) : undefined;
          const id = (d.id as string) || '';
          const metaLine = [env, branch, sha ? `#${sha}` : undefined, when]
            .filter(Boolean)
            .join(' · ');
          const health: HealthState = stage
            ? ok
              ? 'ok'
              : building
                ? 'warn'
                : 'down'
            : 'idle';
          // Lead with the commit message; annotate only non-success states.
          const baseName = message || proj;
          const name = ok
            ? baseName
            : `${baseName} — ${building ? 'Building…' : stage || 'Failed'}`;
          return {
            id,
            name,
            state: health,
            meta: metaLine || undefined,
            active: !!id && !!activeId && id === activeId,
            environment: env,
            branch,
            sha,
            author,
            when,
          };
        });
        if (items.length)
          // Deployments are a live build history for context, not resources
          // you pick — mark read-only so they stay off the config picker.
          groups.push({
            kind: 'deployments',
            label: 'Deployments',
            items,
            readonly: true,
          });
      }
    } catch {
      // deployments listing optional — skip quietly
    }

    // Domains: status dot + DNS record count as meta (one cheap count each).
    // Scoped to this portal so we don't dump every domain on the account.
    const zonesRaw: Array<Record<string, unknown>> = await (async () => {
      try {
        const j = await this.get(apiToken, `/zones?per_page=50`);
        const all = (j?.result as Array<Record<string, unknown>>) ?? [];
        return all.filter((z) => inScope(String(z.name ?? ''), scopeRepos));
      } catch {
        return [];
      }
    })();
    if (zonesRaw.length) {
      const zoneItems: PluginResourceItem[] = [];
      for (const z of zonesRaw) {
        const status = (z.status as string) || '';
        let meta: string | undefined;
        try {
          const n = await this.countVia(
            apiToken,
            `/zones/${z.id as string}/dns_records`,
          );
          meta = `${n} DNS`;
        } catch {
          // DNS read may be out of scope — leave meta off for this zone
        }
        zoneItems.push({
          id: z.id as string,
          name: z.name as string,
          state: status === 'active' ? 'ok' : 'warn',
          meta,
        });
      }
      groups.push({ kind: 'zones', label: 'Domains', items: zoneItems });
    }

    const workers = (
      await safeList(
        `/accounts/${accountId}/workers/scripts`,
        (w) => ({
          id: w.id as string,
          name: w.id as string,
          meta: w.modified_on ? timeAgo(w.modified_on as string) : undefined,
        }),
        (j) => (j.result as Array<Record<string, unknown>>) ?? [],
      )
    ).filter((w) => inScope(w.name, scopeRepos));
    if (workers.length)
      groups.push({ kind: 'workers', label: 'Workers', items: workers });

    const r2 = (
      await safeList(
        `/accounts/${accountId}/r2/buckets`,
        (b) => {
          const loc = (b.location as string) || '';
          const cls = (b.storage_class as string) || '';
          return {
            id: b.name as string,
            name: b.name as string,
            meta: [loc, cls].filter(Boolean).join(' · ') || undefined,
          };
        },
        (j) =>
          ((j.result as Record<string, unknown>)?.buckets as Array<
            Record<string, unknown>
          >) ?? [],
      )
    ).filter((b) => inScope(b.name, scopeRepos));
    if (r2.length) groups.push({ kind: 'r2', label: 'R2 buckets', items: r2 });

    return groups;
  }

  /** True when the user picked at least one resource of any kind. */
  private hasSelection(sel?: PluginSelection): boolean {
    if (!sel) return false;
    return !!(
      sel.pages?.length ||
      sel.zones?.length ||
      sel.workers?.length ||
      sel.r2?.length
    );
  }

  async testConnection(config: PluginConfig) {
    const { apiToken } = this.cfg(config);
    if (!apiToken) return { ok: false, error: 'An API token is required.' };
    try {
      // 1. Token must see at least one account.
      const json = await this.get(apiToken, '/accounts');
      const accountId = json?.result?.[0]?.id as string | undefined;
      if (!accountId) {
        return {
          ok: false,
          error:
            'This token can\'t see any account. Create it with the "Account" resource included (Account → your account), not zone-only.',
        };
      }
      // 2. Verify it can actually reach Pages — this is what a deploy needs, and
      // the #1 cause of "it connected but the deploy failed later". A zone-only
      // (DNS) token lists accounts but 403s here.
      try {
        await this.get(apiToken, `/accounts/${accountId}/pages/projects`);
      } catch (err) {
        const msg = (err as Error).message || '';
        if (/403|forbidden|not authorized|9109|authentication/i.test(msg)) {
          return {
            ok: false,
            error:
              'The token is missing the "Cloudflare Pages" permission, so citshe can\'t deploy sites. Edit the token and add Account → Cloudflare Pages → Edit, then reconnect.',
          };
        }
        // A non-permission error (network etc.) shouldn't block connecting.
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async getStatus(config: PluginConfig): Promise<PluginStatus> {
    const { apiToken, selection } = this.cfg(config);
    const accountId = await this.resolveAccount(this.cfg(config));
    const filtered = this.hasSelection(selection);

    const metrics: PluginMetric[] = [];
    const items: PluginItem[] = [];
    const actions: PluginAction[] = [];
    const warnings: PluginWarning[] = [];
    let latestProject: string | undefined;
    let headline: { label: string; state: HealthState } = {
      label: 'Connected',
      state: 'ok',
    };

    const selPages = new Set(selection?.pages ?? []);
    const wantPages = !filtered || selPages.size > 0;

    // --- Pages: projects + the freshest deployment (the "is it live") ---
    if (wantPages)
      try {
        const json = await this.get(
          apiToken,
          `/accounts/${accountId}/pages/projects`,
        );
        let projects: Array<Record<string, unknown>> = json?.result ?? [];
        // Scope to THIS portal (like listResources does) so the headline "Live"
        // and the redeploy/add-domain actions target the portal's own Pages
        // project — not whatever site deployed most recently account-wide.
        const scopeRepos = this.cfg(config).scopeRepos;
        projects = projects.filter((p) =>
          inScope(String(p.name ?? ''), scopeRepos),
        );
        if (filtered)
          projects = projects.filter((p) => selPages.has(p.name as string));
        metrics.push({
          label: 'Pages projects',
          value: String(projects.length),
          section: 'details',
        });

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
          latestProject = latest.name;
          const ok = latest.stage === 'success' || latest.stage === 'active';
          const building =
            latest.stage === 'building' || latest.stage === 'queued';
          headline = {
            label: ok ? 'Live' : building ? 'Deploying' : 'Deploy failed',
            state: ok ? 'ok' : building ? 'warn' : 'down',
          };
          // Normalize the deploy stage to a compact READY/BUILDING/ERROR-style
          // status so it reads the same as Vercel's Last deploy hint.
          const stageLabel = ok
            ? 'READY'
            : building
              ? 'BUILDING'
              : (latest.stage || 'error').toUpperCase();
          metrics.push({
            label: 'Last deploy',
            value: timeAgo(latest.when),
            hint: `${stageLabel} · ${latest.name}`,
            state: ok ? 'ok' : building ? 'warn' : 'down',
            section: 'hero',
          });
          // Offer a one-click redeploy of the freshest project.
          actions.push({
            id: `redeploy:${latest.name}`,
            label: 'Redeploy',
            target: latest.name,
            confirm: true,
          });
          // And attach a custom subdomain to that project.
          actions.push({
            id: `add-domain:${latest.name}`,
            label: 'Add subdomain',
            target: latest.name,
            prompt: `Custom domain to attach to ${latest.name} (e.g. app.example.com)`,
          });
        }

        // Surface the custom domains already on the freshest project, and count
        // them so we can flag "no custom domain" (running only on *.pages.dev).
        let customDomainCount = 0;
        if (latestProject) {
          try {
            const dj = await this.get(
              apiToken,
              `/accounts/${accountId}/pages/projects/${latestProject}/domains`,
            );
            const domains: Array<Record<string, unknown>> = dj?.result ?? [];
            for (const d of domains) {
              const name = (d.name as string) || '';
              // *.pages.dev is the built-in default, not a custom domain.
              if (name && !name.endsWith('.pages.dev')) customDomainCount++;
            }
            for (const d of domains.slice(0, 5)) {
              const st = (d.status as string) || '';
              items.push({
                label: (d.name as string) || 'domain',
                value: st || 'domain',
                state: st === 'active' ? 'ok' : 'warn',
              });
            }
          } catch {
            // domains listing optional
          }
        }

        // Setup checklist: read the project detail to see whether it's wired to
        // a Git repo (auto-deploy) or deployed by manual upload (Wrangler). We
        // signal these rather than auto-fixing them — connecting a repo is a
        // one-time click in Cloudflare's own dashboard (OAuth, not API).
        if (latestProject) {
          try {
            const pj = await this.get(
              apiToken,
              `/accounts/${accountId}/pages/projects/${latestProject}`,
            );
            const proj = (pj?.result ?? {}) as Record<string, unknown>;
            // `source` is present (type: 'github'/'gitlab') when a repo is
            // connected; absent/null for direct-upload projects.
            const source = proj.source as Record<string, unknown> | null;
            const hasGit = !!source && !!source.type;

            // A plain link (not a runAction) straight to this project's page in
            // the Cloudflare dashboard — where the user connects a repo / flips
            // auto-deploy on. It's a fix-it-yourself step, not something we run.
            const openInCf = {
              label: 'Open in Cloudflare',
              url: `https://dash.cloudflare.com/${accountId}/pages/view/${latestProject}`,
            };

            if (!hasGit) {
              warnings.push({
                code: 'no_git_connection',
                severity: 'warn',
                label: 'No Git connection',
                description:
                  'This site is deployed by manual upload. Connect its repo in Cloudflare (one-time, ~2 min) so every push auto-deploys.',
                link: openInCf,
              });
            } else {
              // Git connected — is the production auto-deploy trigger on?
              const cfg = (proj.deployment_configs ?? {}) as Record<
                string,
                unknown
              >;
              const prod = (cfg.production ?? {}) as Record<string, unknown>;
              const trigger = prod.deployment_trigger as
                | Record<string, unknown>
                | undefined;
              // Cloudflare marks auto-deploy off when the trigger type is
              // 'ad_hoc' (manual) rather than 'github:push'/'git' etc.
              const triggerType = (
                (trigger?.type as string) || ''
              ).toLowerCase();
              const autoOff =
                !trigger ||
                triggerType === 'ad_hoc' ||
                triggerType === 'manual';
              if (autoOff) {
                warnings.push({
                  code: 'autodeploy_off',
                  severity: 'warn',
                  label: 'Auto-deploy off',
                  description:
                    'A repo is connected but production auto-deploy is off — pushes won’t deploy until you enable it in Cloudflare.',
                  link: openInCf,
                });
              }
            }

            if (customDomainCount === 0) {
              warnings.push({
                code: 'no_custom_domain',
                severity: 'info',
                label: 'No custom domain',
                description:
                  'Running on the default *.pages.dev address. Add your own domain in Cloudflare when you’re ready.',
                action: {
                  id: `add-domain:${latestProject}`,
                  label: 'Add domain',
                  target: latestProject,
                  prompt: `Custom domain to attach to ${latestProject} (e.g. app.example.com)`,
                },
              });
            }
          } catch {
            // project-detail read optional — no checklist if it fails
          }
        }

        // Recent deployments count for the freshest project (mirrors Vercel's
        // Deployments metric). Cheap single call, resilient: omit on failure.
        if (latestProject) {
          try {
            const lj = await this.get(
              apiToken,
              `/accounts/${accountId}/pages/projects/${latestProject}/deployments?per_page=20`,
            );
            const deploys: Array<Record<string, unknown>> = lj?.result ?? [];
            if (deploys.length) {
              metrics.push({
                label: 'Deployments',
                value: String(deploys.length),
                hint: latestProject,
                section: 'details',
              });
            }
          } catch {
            // deployments listing optional — skip quietly
          }
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

    // --- Domains (zones): status + DNS record count, and pick a primary zone
    // to pull 24h traffic analytics from. When nothing is selected we still
    // discover zones so the card shows traffic + DNS totals out of the box.
    const selZones = selection?.zones ?? [];
    let zoneList: Array<{
      id: string;
      name: string;
      status: string;
      plan?: string;
    }> = [];
    try {
      if (selZones.length) {
        for (const zoneId of selZones.slice(0, 8)) {
          try {
            const zj = await this.get(apiToken, `/zones/${zoneId}`);
            const z = zj?.result;
            if (z?.id)
              zoneList.push({
                id: z.id as string,
                name: (z.name as string) || zoneId,
                status: (z.status as string) || '',
                plan: (z.plan as { name?: string } | undefined)?.name,
              });
          } catch {
            // zone unavailable — skip
          }
        }
      } else {
        const zj = await this.get(apiToken, `/zones?per_page=50`);
        const scopeRepos = this.cfg(config).scopeRepos;
        zoneList = ((zj?.result as Array<Record<string, unknown>>) ?? [])
          .filter((z) => inScope(String(z.name ?? ''), scopeRepos))
          .map((z) => ({
            id: z.id as string,
            name: z.name as string,
            status: (z.status as string) || '',
            plan: (z.plan as { name?: string } | undefined)?.name,
          }));
      }
    } catch {
      // zone listing optional — skip quietly
    }

    if (zoneList.length) {
      metrics.push({
        label: 'Domains',
        value: String(zoneList.length),
        section: 'details',
      });

      // Account plan surfaced from the zone's plan.name (best-effort).
      const plan = zoneList.find((z) => z.plan)?.plan;
      if (plan) {
        metrics.push({
          label: 'Account plan',
          value: plan,
          section: 'details',
        });
      }

      // DNS records across the (up to 8) surfaced zones — one cheap
      // total_count call each. Resilient: partial totals are fine.
      let dnsTotal = 0;
      let dnsCounted = false;
      for (const z of zoneList.slice(0, 8)) {
        try {
          const n = await this.countVia(apiToken, `/zones/${z.id}/dns_records`);
          dnsTotal += n;
          dnsCounted = true;
        } catch {
          // token may lack DNS read — skip this zone
        }
      }
      if (dnsCounted) {
        metrics.push({
          label: 'DNS records',
          value: compact(dnsTotal),
          section: 'details',
        });
      }

      // Per-zone status rows (with DNS count as a compact hint on the value).
      for (const z of zoneList.slice(0, 6)) {
        items.push({
          label: z.name,
          value: z.status || 'zone',
          state: z.status === 'active' ? 'ok' : 'warn',
        });
      }
    }

    // --- 24h traffic analytics for the primary (first active) zone ---
    const primaryZone =
      zoneList.find((z) => z.status === 'active') ?? zoneList[0];
    if (primaryZone) {
      try {
        const t = await this.zoneTraffic(apiToken, primaryZone.id);
        if (t) {
          // Hourly sparkline series for the last 24h (best-effort — omitted on
          // failure so the metric still shows its aggregate value).
          const hourly = await this.zoneTrafficSeries(apiToken, primaryZone.id);
          const labels = hourly?.labels?.length ? hourly.labels : undefined;
          metrics.push({
            label: 'Requests 24h',
            value: compact(t.requests),
            hint: primaryZone.name,
            section: 'usage',
            ...(hourly?.requests.length
              ? {
                  series: hourly.requests,
                  seriesKind: 'area' as const,
                  ...(labels ? { seriesLabels: labels } : {}),
                  seriesMulti: [
                    { label: '2xx', values: hourly.status.s2xx },
                    { label: '3xx', values: hourly.status.s3xx },
                    { label: '4xx', values: hourly.status.s4xx },
                    { label: '5xx', values: hourly.status.s5xx },
                  ],
                }
              : {}),
          });
          metrics.push({
            label: 'Bandwidth 24h',
            value: humanBytes(t.bytes),
            hint: primaryZone.name,
            section: 'usage',
            ...(hourly?.bytes.length
              ? {
                  series: hourly.bytes,
                  seriesKind: 'area' as const,
                  ...(labels ? { seriesLabels: labels } : {}),
                }
              : {}),
          });

          // Error rate over the 24h window from the hourly status split.
          if (hourly?.requests.length) {
            const total = hourly.requests.reduce((a, b) => a + b, 0);
            if (total > 0) {
              const errs = hourly.status.s4xx
                .map((v, i) => v + (hourly.status.s5xx[i] ?? 0))
                .reduce((a, b) => a + b, 0);
              const pct = (errs / total) * 100;
              // Hourly error% line (0 when an hour had no requests).
              const errSeries = hourly.requests.map((req, i) => {
                if (!req) return 0;
                const e =
                  (hourly.status.s4xx[i] ?? 0) + (hourly.status.s5xx[i] ?? 0);
                return Math.round((e / req) * 1000) / 10;
              });
              metrics.push({
                label: 'Error rate',
                value: `${pct.toFixed(1)}%`,
                state: pct > 15 ? 'down' : pct > 5 ? 'warn' : 'ok',
                section: 'usage',
                series: errSeries,
                seriesKind: 'line' as const,
                unit: '%',
                ...(labels ? { seriesLabels: labels } : {}),
              });
            }
          }

          if (t.requests > 0) {
            const cachedPct = Math.round((t.cachedRequests / t.requests) * 100);
            // Hourly cache-hit-rate line (0 when an hour had no requests).
            const cacheSeries = hourly?.requests.length
              ? hourly.requests.map((req, i) => {
                  if (!req) return 0;
                  return Math.round(((hourly.cached[i] ?? 0) / req) * 100);
                })
              : undefined;
            metrics.push({
              label: 'Cached',
              value: `${cachedPct}%`,
              state: cachedPct >= 50 ? 'ok' : 'warn',
              section: 'details',
              ...(cacheSeries
                ? {
                    series: cacheSeries,
                    seriesKind: 'line' as const,
                    unit: '%',
                    ...(labels ? { seriesLabels: labels } : {}),
                  }
                : {}),
            });
          }
          metrics.push({
            label: 'Threats 24h',
            value: compact(t.threats),
            state: t.threats > 0 ? 'warn' : 'ok',
            section: 'details',
          });
        }
      } catch {
        // analytics scope missing — skip the whole block quietly
      }
    }

    // --- R2 buckets (filtered to selection when set) ---
    const selR2 = new Set(selection?.r2 ?? []);
    if (!filtered || selR2.size > 0)
      try {
        const json = await this.get(
          apiToken,
          `/accounts/${accountId}/r2/buckets`,
        );
        let buckets: Array<Record<string, unknown>> =
          json?.result?.buckets ?? [];
        if (filtered)
          buckets = buckets.filter((b) => selR2.has(b.name as string));
        metrics.push({
          label: 'R2 buckets',
          value: String(buckets.length),
          section: 'details',
        });
        // Surface a few buckets with their location/class as the value line.
        for (const b of buckets.slice(0, 4)) {
          const loc = (b.location as string) || '';
          const cls = (b.storage_class as string) || '';
          const meta = [loc, cls].filter(Boolean).join(' · ');
          items.push({
            label: (b.name as string) || 'bucket',
            value: meta || 'bucket',
            state: 'ok',
          });
        }
      } catch {
        // R2 may be off / token lacks scope — skip quietly.
      }

    // --- Workers (filtered to selection when set) ---
    const selWorkers = new Set(selection?.workers ?? []);
    if (!filtered || selWorkers.size > 0)
      try {
        const json = await this.get(
          apiToken,
          `/accounts/${accountId}/workers/scripts`,
        );
        let scripts: Array<Record<string, unknown>> = json?.result ?? [];
        if (filtered)
          scripts = scripts.filter((s) => selWorkers.has(s.id as string));
        if (scripts.length) {
          // Hourly invocation series across all scripts (best-effort). Omitted
          // if the account has no Workers analytics / token lacks scope.
          const wseries = await this.workersSeries(apiToken, accountId);
          metrics.push({
            label: 'Workers',
            value: String(scripts.length),
            section: 'details',
            ...(wseries?.requests.length
              ? { series: wseries.requests, seriesKind: 'area' as const }
              : {}),
          });
          // Separate Workers error series only when there are actual errors.
          if (wseries?.errors.length && wseries.errors.some((e) => e > 0)) {
            const totalErr = wseries.errors.reduce((a, b) => a + b, 0);
            metrics.push({
              label: 'Worker errors 24h',
              value: compact(totalErr),
              state: 'warn',
              section: 'details',
              series: wseries.errors,
              seriesKind: 'line' as const,
            });
          }
          // Show the freshest few workers with their last-modified time.
          const ranked = [...scripts].sort(
            (a, b) =>
              +new Date((b.modified_on as string) || 0) -
              +new Date((a.modified_on as string) || 0),
          );
          for (const s of ranked.slice(0, 4)) {
            const mod = s.modified_on as string | undefined;
            items.push({
              label: (s.id as string) || 'worker',
              value: mod ? timeAgo(mod) : 'worker',
              state: 'ok',
            });
          }
        }
      } catch {
        // optional
      }

    if (metrics.length === 0) {
      metrics.push({ label: 'Cloudflare', value: 'connected' });
    }

    void latestProject; // captured for potential future defaulting

    return {
      type: this.type,
      connected: true,
      headline,
      metrics,
      items: items.length ? items : undefined,
      actions: actions.length ? actions : undefined,
      warnings: warnings.length ? warnings : undefined,
      links: [
        {
          label: 'Open in Cloudflare',
          url: `https://dash.cloudflare.com/${accountId}`,
        },
      ],
    };
  }

  /** Write-actions: redeploy a Pages project, or attach a custom subdomain. */
  async runAction(
    config: PluginConfig,
    actionId: string,
    input?: Record<string, unknown>,
  ): Promise<PluginActionResult> {
    const { apiToken } = this.cfg(config);
    const accountId = await this.resolveAccount(this.cfg(config));

    if (actionId.startsWith('add-domain:')) {
      const project = actionId.slice('add-domain:'.length);
      const domain = String(input?.value || '').trim();
      if (!domain) return { ok: false, message: 'No domain provided.' };
      try {
        const res = await fetch(
          `${API}/accounts/${accountId}/pages/projects/${project}/domains`,
          {
            method: 'POST',
            headers: cfHeaders(apiToken),
            body: JSON.stringify({ name: domain }),
          },
        );
        if (!res.ok) {
          const body = await res.text();
          return {
            ok: false,
            message: `Cloudflare ${res.status}: ${body.slice(0, 140)}`,
          };
        }
        return {
          ok: true,
          message: `Added ${domain} to ${project}. Point its DNS (CNAME → ${project}.pages.dev) to finish.`,
        };
      } catch (err) {
        return { ok: false, message: (err as Error).message };
      }
    }

    if (actionId.startsWith('redeploy:')) {
      const project = actionId.slice('redeploy:'.length);
      try {
        // Re-run the most recent deployment for the project.
        const list = await this.get(
          apiToken,
          `/accounts/${accountId}/pages/projects/${project}/deployments?per_page=1`,
        );
        const dep = list?.result?.[0];
        if (!dep?.id) {
          return {
            ok: false,
            message: `No deployment to redeploy for ${project}.`,
          };
        }
        const res = await fetch(
          `${API}/accounts/${accountId}/pages/projects/${project}/deployments/${dep.id}/retry`,
          { method: 'POST', headers: cfHeaders(apiToken) },
        );
        if (!res.ok) {
          return { ok: false, message: `Cloudflare returned ${res.status}` };
        }
        return { ok: true, message: `Redeploying ${project}…` };
      } catch (err) {
        return { ok: false, message: (err as Error).message };
      }
    }

    return { ok: false, message: `Unknown action: ${actionId}` };
  }

  /** Recent PREVIEW deployments (branch builds) for a repo's Pages project. */
  async listPreviews(
    config: PluginConfig,
    repoName?: string,
  ): Promise<PreviewDeployment[]> {
    const { apiToken } = this.cfg(config);
    const accountId = await this.resolveAccount(this.cfg(config));

    // Find the matching Pages project(s) by name.
    let projects: string[] = [];
    try {
      const json = await this.get(
        apiToken,
        `/accounts/${accountId}/pages/projects`,
      );
      projects = (json?.result ?? [])
        .map((p: Record<string, unknown>) => p.name as string)
        .filter((n: string) => nameMatches(n, repoName));
    } catch {
      return [];
    }

    const previews: PreviewDeployment[] = [];
    for (const project of projects.slice(0, 3)) {
      try {
        const json = await this.get(
          apiToken,
          `/accounts/${accountId}/pages/projects/${project}/deployments?per_page=20`,
        );
        for (const dep of json?.result ?? []) {
          if (dep.environment !== 'preview') continue;
          const stage = dep.latest_stage?.status;
          const state: HealthState =
            stage === 'success'
              ? 'ok'
              : stage === 'building' || stage === 'queued'
                ? 'warn'
                : 'down';
          previews.push({
            url: dep.url,
            branch: dep.deployment_trigger?.metadata?.branch,
            commit: dep.deployment_trigger?.metadata?.commit_hash?.slice(0, 7),
            when: dep.created_on,
            state,
            project,
            provider: 'cloudflare',
          });
        }
      } catch {
        // skip project
      }
    }
    return previews.slice(0, 8);
  }
}

pluginRegistry.register(new CloudflarePlugin());
