import { PluginType } from '@prisma/client';
import * as jwt from 'jsonwebtoken';
import {
  PluginConfig,
  PluginStatus,
  StackPlugin,
  PluginMetric,
  PluginItem,
  PluginResourceGroup,
  PluginResourceItem,
  PluginResourceDetail,
  HealthState,
} from './plugin.interface';
import { pluginRegistry } from './plugin.registry';

/**
 * Apple Developer (App Store Connect API) stack plugin.
 *
 * Auth is NOT a bearer token — every request needs a short-lived ES256 JWT
 * signed with your API key's private key (.p8), keyed by the key ID and issued
 * by your issuer ID (see developer.apple.com/documentation/appstoreconnectapi/
 * generating-tokens-for-api-requests). We mint a fresh JWT per getStatus call
 * (valid 19 min, under Apple's 20 min cap) and send it as `Bearer`.
 *
 * The killer feature: certificate & provisioning-profile expiry — "is my
 * signing about to break". We flag anything expiring within 30 days.
 *
 * Honest scope: we read apps, certificates, profiles and builds. All are best
 * effort — a JWT mint failure or a 401/403 (key lacks access to a resource)
 * omits that section rather than throwing.
 */

const API = 'https://api.appstoreconnect.apple.com/v1';
const AUDIENCE = 'appstoreconnect-v1';
const EXPIRING_SOON_DAYS = 30;

interface AppleConfig {
  keyId: string;
  issuerId: string;
  /** The full .p8 private key contents (BEGIN PRIVATE KEY … END PRIVATE KEY). */
  privateKey: string;
}

type Rec = Record<string, unknown>;
type Resource = { id: string; type: string; attributes: Rec };

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Whole days until an ISO date (negative = already expired). */
function daysUntil(iso?: string): number | undefined {
  if (!iso) return undefined;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return undefined;
  return Math.floor((t - Date.now()) / (24 * 60 * 60 * 1000));
}

/** Health tint for an expiry: expired = down, <30d = warn, else ok. */
function expiryHealth(iso?: string): { state: HealthState; label: string } {
  const d = daysUntil(iso);
  if (d === undefined) return { state: 'idle', label: 'no expiry' };
  if (d < 0) return { state: 'down', label: 'expired' };
  if (d <= EXPIRING_SOON_DAYS)
    return { state: 'warn', label: `expires in ${d}d` };
  return { state: 'ok', label: `expires in ${d}d` };
}

class AppleDeveloperPlugin implements StackPlugin {
  type = PluginType.APPLE_DEVELOPER;

  private cfg(config: PluginConfig): AppleConfig {
    return config as unknown as AppleConfig;
  }

  /**
   * Mint a short-lived ES256 JWT for the App Store Connect API. Throws with a
   * clear message if the key ID / issuer ID / .p8 is missing or malformed.
   */
  private mintJwt(c: AppleConfig): string {
    if (!c.keyId || !c.issuerId || !c.privateKey) {
      throw new Error('Key ID, Issuer ID and the .p8 private key are all required.');
    }
    const now = Math.floor(Date.now() / 1000);
    // Normalize escaped newlines so a pasted single-line .p8 still parses.
    const key = c.privateKey.includes('\\n')
      ? c.privateKey.replace(/\\n/g, '\n')
      : c.privateKey;
    try {
      return jwt.sign(
        { iss: c.issuerId, iat: now, exp: now + 19 * 60, aud: AUDIENCE },
        key,
        { algorithm: 'ES256', header: { alg: 'ES256', kid: c.keyId, typ: 'JWT' } },
      );
    } catch (err) {
      throw new Error(`Could not sign JWT — check the .p8 key. (${(err as Error).message})`);
    }
  }

  /** Authed GET against the App Store Connect API. Throws on non-2xx. */
  private async get(token: string, path: string): Promise<{ data?: Resource[] }> {
    const res = await fetch(`${API}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(`App Store Connect returned ${res.status}`);
    }
    return res.json() as Promise<{ data?: Resource[] }>;
  }

  async testConnection(config: PluginConfig) {
    const c = this.cfg(config);
    let token: string;
    try {
      token = this.mintJwt(c);
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
    try {
      const res = await fetch(`${API}/apps?limit=1`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        return { ok: false, error: 'Key rejected (401) — check key ID / issuer ID / key.' };
      }
      if (!res.ok) {
        return { ok: false, error: `App Store Connect rejected the request (${res.status}).` };
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

    let token: string;
    try {
      token = this.mintJwt(c);
    } catch (err) {
      // Can't mint → nothing works. Return a clear, connected-but-broken status.
      return {
        type: this.type,
        connected: false,
        headline: { label: 'Auth failed', state: 'down' },
        metrics: [{ label: 'Apple', value: 'JWT mint failed', state: 'down' }],
        error: (err as Error).message,
        links: [
          { label: 'Open App Store Connect', url: 'https://appstoreconnect.apple.com' },
        ],
      };
    }

    // --- Apps (name · bundleId) ---
    try {
      const json = await this.get(token, '/apps?limit=200');
      const apps = json.data ?? [];
      metrics.push({
        label: 'Apps',
        value: String(apps.length),
        section: 'details',
      });
      const first = apps[0];
      if (first) {
        const name = (first.attributes.name as string) || (first.attributes.bundleId as string);
        if (name) {
          metrics.push({
            label: 'App',
            value: name,
            hint: (first.attributes.bundleId as string) || undefined,
            section: 'details',
          });
        }
      }
    } catch {
      // apps optional — skip quietly
    }

    // --- Certificates (+ expiring-soon warning — the killer feature) ---
    try {
      const json = await this.get(token, '/certificates?limit=200');
      const certs = json.data ?? [];
      const expired = certs.filter((x) => {
        const d = daysUntil(x.attributes.expirationDate as string);
        return d !== undefined && d < 0;
      }).length;
      const soon = certs.filter((x) => {
        const d = daysUntil(x.attributes.expirationDate as string);
        return d !== undefined && d >= 0 && d <= EXPIRING_SOON_DAYS;
      }).length;
      const hintParts = [
        expired ? `${expired} expired` : undefined,
        soon ? `${soon} expiring soon` : undefined,
      ].filter(Boolean) as string[];
      const state: HealthState | undefined = expired
        ? 'down'
        : soon
          ? 'warn'
          : undefined;
      metrics.push({
        label: 'Certificates',
        value: String(certs.length),
        hint: hintParts.length ? hintParts.join(' · ') : undefined,
        state,
        section: 'details',
      });
      if (state) {
        headline = {
          label: expired ? 'Certificate expired' : 'Certificate expiring',
          state,
        };
      }
      // Surface the soonest-expiring certs in the items list.
      const withExpiry = certs
        .map((x) => ({
          name:
            (x.attributes.name as string) ||
            (x.attributes.displayName as string) ||
            (x.attributes.certificateType as string) ||
            'certificate',
          exp: x.attributes.expirationDate as string,
          d: daysUntil(x.attributes.expirationDate as string),
        }))
        .filter((x) => x.d !== undefined)
        .sort((a, b) => (a.d as number) - (b.d as number));
      for (const cert of withExpiry.slice(0, 4)) {
        const h = expiryHealth(cert.exp);
        items.push({ label: cert.name, value: h.label, state: h.state });
      }
    } catch {
      // certificates optional — skip quietly
    }

    // --- Provisioning profiles (+ expiring-soon) ---
    try {
      const json = await this.get(token, '/profiles?limit=200');
      const profiles = json.data ?? [];
      const expired = profiles.filter((x) => {
        const d = daysUntil(x.attributes.expirationDate as string);
        return d !== undefined && d < 0;
      }).length;
      const soon = profiles.filter((x) => {
        const d = daysUntil(x.attributes.expirationDate as string);
        return d !== undefined && d >= 0 && d <= EXPIRING_SOON_DAYS;
      }).length;
      const invalid = profiles.filter(
        (x) => (x.attributes.profileState as string) === 'INVALID',
      ).length;
      const hintParts = [
        expired ? `${expired} expired` : undefined,
        soon ? `${soon} expiring soon` : undefined,
        invalid ? `${invalid} invalid` : undefined,
      ].filter(Boolean) as string[];
      const state: HealthState | undefined =
        expired || invalid ? 'down' : soon ? 'warn' : undefined;
      metrics.push({
        label: 'Profiles',
        value: String(profiles.length),
        hint: hintParts.length ? hintParts.join(' · ') : undefined,
        state,
        section: 'details',
      });
      if (state === 'down' && headline.state !== 'down') {
        headline = { label: 'Profile problem', state: 'down' };
      }
    } catch {
      // profiles optional — skip quietly
    }

    // --- Latest beta build (version · uploaded when) ---
    try {
      // Sort by upload date desc so the freshest build is first.
      const json = await this.get(token, '/builds?limit=1&sort=-uploadedDate');
      const build = (json.data ?? [])[0];
      if (build) {
        const version = (build.attributes.version as string) || undefined;
        const uploaded = build.attributes.uploadedDate as string | undefined;
        const processing = (build.attributes.processingState as string) || undefined;
        const state: HealthState =
          processing === 'VALID'
            ? 'ok'
            : processing === 'FAILED' || processing === 'INVALID'
              ? 'down'
              : 'warn';
        metrics.push({
          label: 'Latest build',
          value: version ? `v${version}` : (processing || 'build'),
          hint: uploaded ? timeAgo(uploaded) : processing,
          state,
          section: 'details',
        });
      }
    } catch {
      // builds optional — skip quietly
    }

    if (metrics.length === 0) {
      metrics.push({ label: 'Apple', value: 'connected' });
    }

    return {
      type: this.type,
      connected: true,
      headline,
      metrics,
      items: items.length ? items : undefined,
      links: [
        { label: 'Open App Store Connect', url: 'https://appstoreconnect.apple.com' },
      ],
    };
  }

  /** Apps · certificates · profiles · builds the key can see, grouped. */
  async listResources(config: PluginConfig): Promise<PluginResourceGroup[]> {
    const c = this.cfg(config);
    const groups: PluginResourceGroup[] = [];

    let token: string;
    try {
      token = this.mintJwt(c);
    } catch {
      return groups;
    }

    // --- Apps (bundleId · sku) ---
    try {
      const json = await this.get(token, '/apps?limit=200');
      const items: PluginResourceItem[] = (json.data ?? []).map((a) => {
        const bundleId = a.attributes.bundleId as string | undefined;
        const sku = a.attributes.sku as string | undefined;
        const metaParts = [bundleId, sku ? `SKU ${sku}` : undefined].filter(
          Boolean,
        ) as string[];
        return {
          id: a.id,
          name: (a.attributes.name as string) || bundleId || a.id,
          meta: metaParts.length ? metaParts.join(' · ') : undefined,
        };
      });
      if (items.length) groups.push({ kind: 'projects', label: 'Apps', items });
    } catch {
      // apps optional — skip quietly
    }

    // --- Certificates (type · expiry) ---
    try {
      const json = await this.get(token, '/certificates?limit=200');
      const items: PluginResourceItem[] = (json.data ?? [])
        .map((x) => {
          const exp = x.attributes.expirationDate as string | undefined;
          const h = expiryHealth(exp);
          const type = x.attributes.certificateType as string | undefined;
          const details: PluginResourceDetail[] = [];
          if (type) details.push({ label: 'Type', value: type });
          if (x.attributes.platform)
            details.push({ label: 'Platform', value: x.attributes.platform as string });
          if (exp)
            details.push({
              label: 'Expires',
              value: new Date(exp).toISOString().slice(0, 10),
              state: h.state,
            });
          if (x.attributes.serialNumber)
            details.push({ label: 'Serial', value: x.attributes.serialNumber as string });
          const metaParts = [type, exp ? h.label : undefined].filter(
            Boolean,
          ) as string[];
          return {
            _sort: daysUntil(exp) ?? Number.MAX_SAFE_INTEGER,
            item: {
              id: x.id,
              name:
                (x.attributes.name as string) ||
                (x.attributes.displayName as string) ||
                type ||
                x.id,
              state: h.state,
              meta: metaParts.length ? metaParts.join(' · ') : undefined,
              details: details.length ? details : undefined,
            } as PluginResourceItem,
          };
        })
        .sort((a, b) => a._sort - b._sort)
        .map((x) => x.item);
      if (items.length)
        groups.push({ kind: 'domains', label: 'Certificates', items });
    } catch {
      // certificates optional — skip quietly
    }

    // --- Provisioning profiles (type · state · expiry) ---
    try {
      const json = await this.get(token, '/profiles?limit=200');
      const items: PluginResourceItem[] = (json.data ?? [])
        .map((x) => {
          const exp = x.attributes.expirationDate as string | undefined;
          const pstate = x.attributes.profileState as string | undefined;
          const h = expiryHealth(exp);
          // INVALID profiles are down regardless of expiry.
          const state: HealthState = pstate === 'INVALID' ? 'down' : h.state;
          const details: PluginResourceDetail[] = [];
          if (x.attributes.profileType)
            details.push({ label: 'Type', value: x.attributes.profileType as string });
          if (pstate) details.push({ label: 'State', value: pstate, state });
          if (exp)
            details.push({
              label: 'Expires',
              value: new Date(exp).toISOString().slice(0, 10),
              state: h.state,
            });
          const metaParts = [
            x.attributes.profileType as string | undefined,
            pstate,
            exp ? h.label : undefined,
          ].filter(Boolean) as string[];
          return {
            _sort: daysUntil(exp) ?? Number.MAX_SAFE_INTEGER,
            item: {
              id: x.id,
              name: (x.attributes.name as string) || x.id,
              state,
              meta: metaParts.length ? metaParts.join(' · ') : undefined,
              details: details.length ? details : undefined,
            } as PluginResourceItem,
          };
        })
        .sort((a, b) => a._sort - b._sort)
        .map((x) => x.item);
      if (items.length)
        groups.push({ kind: 'domains', label: 'Provisioning profiles', items });
    } catch {
      // profiles optional — skip quietly
    }

    // --- Builds (version · processing state · when) ---
    try {
      const json = await this.get(token, '/builds?limit=50&sort=-uploadedDate');
      const items: PluginResourceItem[] = (json.data ?? []).map((b) => {
        const version = b.attributes.version as string | undefined;
        const processing = b.attributes.processingState as string | undefined;
        const uploaded = b.attributes.uploadedDate as string | undefined;
        const expired = b.attributes.expired === true;
        const state: HealthState = expired
          ? 'idle'
          : processing === 'VALID'
            ? 'ok'
            : processing === 'FAILED' || processing === 'INVALID'
              ? 'down'
              : 'warn';
        const metaParts = [
          processing,
          expired ? 'expired' : undefined,
          uploaded ? timeAgo(uploaded) : undefined,
        ].filter(Boolean) as string[];
        return {
          id: b.id,
          name: version ? `Build ${version}` : `Build ${b.id}`,
          state,
          meta: metaParts.length ? metaParts.join(' · ') : undefined,
          when: uploaded ? timeAgo(uploaded) : undefined,
        };
      });
      if (items.length)
        groups.push({ kind: 'deployments', label: 'Builds', items });
    } catch {
      // builds optional — skip quietly
    }

    return groups;
  }
}

pluginRegistry.register(new AppleDeveloperPlugin());
