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

  /** Everything the token can see, grouped — for the resource picker. */
  async listResources(config: PluginConfig): Promise<PluginResourceGroup[]> {
    const { apiToken } = this.cfg(config);
    const accountId = await this.resolveAccount(this.cfg(config));
    const groups: PluginResourceGroup[] = [];

    const safeList = async (
      path: string,
      map: (r: Record<string, unknown>) => { id: string; name: string },
      pick: (json: Record<string, unknown>) => Array<Record<string, unknown>>,
    ) => {
      try {
        const json = await this.get(apiToken, path);
        return pick(json).map(map);
      } catch {
        return [];
      }
    };

    const pages = await safeList(
      `/accounts/${accountId}/pages/projects`,
      (p) => ({ id: p.name as string, name: p.name as string }),
      (j) => (j.result as Array<Record<string, unknown>>) ?? [],
    );
    if (pages.length) groups.push({ kind: 'pages', label: 'Pages', items: pages });

    const zones = await safeList(
      `/zones?per_page=50`,
      (z) => ({ id: z.id as string, name: z.name as string }),
      (j) => (j.result as Array<Record<string, unknown>>) ?? [],
    );
    if (zones.length) groups.push({ kind: 'zones', label: 'Domains', items: zones });

    const workers = await safeList(
      `/accounts/${accountId}/workers/scripts`,
      (w) => ({ id: w.id as string, name: w.id as string }),
      (j) => (j.result as Array<Record<string, unknown>>) ?? [],
    );
    if (workers.length)
      groups.push({ kind: 'workers', label: 'Workers', items: workers });

    const r2 = await safeList(
      `/accounts/${accountId}/r2/buckets`,
      (b) => ({ id: b.name as string, name: b.name as string }),
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
        latestProject = latest.name;
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

    // --- Domains (zones): the selected ones + their status/DNS count ---
    const selZones = selection?.zones ?? [];
    if (selZones.length) {
      for (const zoneId of selZones.slice(0, 8)) {
        try {
          const zj = await this.get(apiToken, `/zones/${zoneId}`);
          const z = zj?.result;
          const st = (z?.status as string) || '';
          items.push({
            label: (z?.name as string) || zoneId,
            value: st || 'zone',
            state: st === 'active' ? 'ok' : 'warn',
          });
        } catch {
          // zone unavailable — skip
        }
      }
      metrics.push({ label: 'Domains', value: String(selZones.length) });
    }

    // --- R2 buckets (filtered to selection when set) ---
    const selR2 = new Set(selection?.r2 ?? []);
    if (!filtered || selR2.size > 0)
      try {
        const json = await this.get(apiToken, `/accounts/${accountId}/r2/buckets`);
        let buckets: Array<Record<string, unknown>> =
          json?.result?.buckets ?? [];
        if (filtered) buckets = buckets.filter((b) => selR2.has(b.name as string));
        metrics.push({ label: 'R2 buckets', value: String(buckets.length) });
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
          metrics.push({ label: 'Workers', value: String(scripts.length) });
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
