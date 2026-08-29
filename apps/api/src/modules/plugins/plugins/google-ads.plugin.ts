import { PluginType } from '@prisma/client';
import {
  PluginConfig,
  PluginStatus,
  StackPlugin,
  PluginMetric,
} from './plugin.interface';
import { pluginRegistry } from './plugin.registry';

const API = 'https://googleads.googleapis.com/v18';

interface AdsConfig {
  developerToken: string;
  // A pre-obtained OAuth2 access token (short-lived) or refresh flow output.
  accessToken?: string;
  customerId: string; // digits only, e.g. 1234567890
  loginCustomerId?: string;
}

/**
 * Google Ads plugin (MVP). Full OAuth is heavy; this connects with a developer
 * token + an access token + customer id and reads basic campaign metrics. If
 * only a developer token is present it reports an honest "limited" status
 * rather than faking numbers — we never invent data.
 */
class GoogleAdsPlugin implements StackPlugin {
  type = PluginType.GOOGLE_ADS;

  private cfg(config: PluginConfig): AdsConfig {
    return config as unknown as AdsConfig;
  }

  async testConnection(config: PluginConfig) {
    const { developerToken, customerId } = this.cfg(config);
    if (!developerToken || !customerId) {
      return {
        ok: false,
        error: 'Developer token and customer ID are required.',
      };
    }
    // Without an access token we can't hit the API; accept as "limited".
    return { ok: true };
  }

  async getStatus(config: PluginConfig): Promise<PluginStatus> {
    const { developerToken, accessToken, customerId, loginCustomerId } =
      this.cfg(config);

    if (!accessToken) {
      // Honest degraded state — connected but can't read live metrics yet.
      return {
        type: this.type,
        connected: true,
        headline: { label: 'Limited', state: 'idle' },
        metrics: [
          {
            label: 'Google Ads',
            value: 'connected (no live metrics)',
            hint: 'add an OAuth access token to read campaign data',
          },
        ],
        links: [
          {
            label: 'Open Google Ads',
            url: 'https://ads.google.com/aw/overview',
          },
        ],
      };
    }

    try {
      const query = `SELECT metrics.cost_micros, metrics.conversions FROM campaign WHERE segments.date DURING LAST_7_DAYS`;
      const res = await fetch(
        `${API}/customers/${customerId}/googleAds:searchStream`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'developer-token': developerToken,
            'Content-Type': 'application/json',
            ...(loginCustomerId
              ? { 'login-customer-id': loginCustomerId }
              : {}),
          },
          body: JSON.stringify({ query }),
        },
      );
      if (!res.ok) {
        throw new Error(`Google Ads returned ${res.status}`);
      }
      const json = await res.json();
      let costMicros = 0;
      let conversions = 0;
      const batches = Array.isArray(json) ? json : [json];
      for (const batch of batches) {
        for (const row of batch?.results ?? []) {
          costMicros += Number(row?.metrics?.costMicros ?? 0);
          conversions += Number(row?.metrics?.conversions ?? 0);
        }
      }
      const metrics: PluginMetric[] = [
        { label: 'Spend 7d', value: `$${(costMicros / 1_000_000).toFixed(2)}` },
        { label: 'Conversions 7d', value: conversions.toFixed(0) },
      ];
      return {
        type: this.type,
        connected: true,
        headline: { label: 'Active', state: 'ok' },
        metrics,
        links: [
          {
            label: 'Open Google Ads',
            url: 'https://ads.google.com/aw/overview',
          },
        ],
      };
    } catch (err) {
      return {
        type: this.type,
        connected: true,
        headline: { label: 'Error', state: 'warn' },
        metrics: [],
        error: (err as Error).message,
        links: [
          {
            label: 'Open Google Ads',
            url: 'https://ads.google.com/aw/overview',
          },
        ],
      };
    }
  }
}

pluginRegistry.register(new GoogleAdsPlugin());
