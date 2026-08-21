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
  PluginResourceGroup,
  PluginResourceItem,
  PluginSelection,
  HealthState,
} from './plugin.interface';
import { pluginRegistry } from './plugin.registry';

/** Fuzzy match a repo name to a project name (ignore separators/case). */
function nameMatches(project: string, repo?: string): boolean {
  if (!repo) return true;
  const norm = (s: string) => s.toLowerCase().replace(/[-_.]/g, '');
  const p = norm(project);
  const r = norm(repo.split('/').pop() || repo);
  return p.includes(r) || r.includes(p);
}

const API = 'https://api.cloudflare.com/client/v4';

interface CfConfig {
  apiToken: string;
  accountId?: string; // optional — auto-detected from the token if absent
  selection?: PluginSelection; // per-portal: which resources to show
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
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
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
    let pagesRaw: Array<Record<string, unknown>> = [];
    try {
      const pj = await this.get(apiToken, `/accounts/${accountId}/pages/projects`);
      pagesRaw = (pj?.result as Array<Record<string, unknown>>) ?? [];
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
    if (pages.length) groups.push({ kind: 'pages', label: 'Pages', items: pages });

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
          const message = (meta.commit_message as string)?.split('\n')[0].trim();
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
            : `${baseName} — ${building ? 'Building…' : (stage || 'Failed')}`;
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
          groups.push({ kind: 'deployments', label: 'Deployments', items });
      }
    } catch {
      // deployments listing optional — skip quietly
    }

    // Domains: status dot + DNS record count as meta (one cheap count each).
    const zonesRaw: Array<Record<string, unknown>> = await (async () => {
      try {
        const j = await this.get(apiToken, `/zones?per_page=50`);
        return (j?.result as Array<Record<string, unknown>>) ?? [];
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

    const workers = await safeList(
      `/accounts/${accountId}/workers/scripts`,
      (w) => ({
        id: w.id as string,
        name: w.id as string,
        meta: w.modified_on
          ? timeAgo(w.modified_on as string)
          : undefined,
      }),
      (j) => (j.result as Array<Record<string, unknown>>) ?? [],
    );
    if (workers.length)
      groups.push({ kind: 'workers', label: 'Workers', items: workers });

    const r2 = await safeList(
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
    );
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
    const { apiToken, selection } = this.cfg(config);
    const accountId = await this.resolveAccount(this.cfg(config));
    const filtered = this.hasSelection(selection);

    const metrics: PluginMetric[] = [];
    const items: PluginItem[] = [];
    const actions: PluginAction[] = [];
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
      if (filtered) projects = projects.filter((p) => selPages.has(p.name as string));
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
        const building = latest.stage === 'building' || latest.stage === 'queued';
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

      // Surface the custom domains already on the freshest project.
      if (latestProject) {
        try {
          const dj = await this.get(
            apiToken,
            `/accounts/${accountId}/pages/projects/${latestProject}/domains`,
          );
          const domains: Array<Record<string, unknown>> = dj?.result ?? [];
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
                name: (z.name as string) || (zoneId as string),
                status: (z.status as string) || '',
                plan: (z.plan as { name?: string } | undefined)?.name,
              });
          } catch {
            // zone unavailable — skip
          }
        }
      } else {
        const zj = await this.get(apiToken, `/zones?per_page=50`);
        zoneList = ((zj?.result as Array<Record<string, unknown>>) ?? []).map(
          (z) => ({
            id: z.id as string,
            name: z.name as string,
            status: (z.status as string) || '',
            plan: (z.plan as { name?: string } | undefined)?.name,
          }),
        );
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
          metrics.push({
            label: 'Requests 24h',
            value: compact(t.requests),
            hint: primaryZone.name,
            section: 'usage',
          });
          metrics.push({
            label: 'Bandwidth 24h',
            value: humanBytes(t.bytes),
            hint: primaryZone.name,
            section: 'usage',
          });
          if (t.requests > 0) {
            const cachedPct = Math.round((t.cachedRequests / t.requests) * 100);
            metrics.push({
              label: 'Cached',
              value: `${cachedPct}%`,
              state: cachedPct >= 50 ? 'ok' : 'warn',
              section: 'details',
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
        const json = await this.get(apiToken, `/accounts/${accountId}/r2/buckets`);
        let buckets: Array<Record<string, unknown>> =
          json?.result?.buckets ?? [];
        if (filtered) buckets = buckets.filter((b) => selR2.has(b.name as string));
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
          metrics.push({
            label: 'Workers',
            value: String(scripts.length),
            section: 'details',
          });
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
          return { ok: false, message: `No deployment to redeploy for ${project}.` };
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
