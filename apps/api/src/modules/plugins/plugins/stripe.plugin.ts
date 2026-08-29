import { PluginType } from '@prisma/client';
import {
  PluginConfig,
  PluginStatus,
  StackPlugin,
  PluginMetric,
  PluginWarning,
} from './plugin.interface';
import { pluginRegistry } from './plugin.registry';

const API = 'https://api.stripe.com/v1';

interface StripeConfig {
  secretKey: string; // sk_test_… / sk_live_…
  webhookSecret?: string; // whsec_…
}

/**
 * Stripe plugin. Answers "are payments live, is it still in test mode, is a
 * webhook wired, how much came in this week" without opening the dashboard.
 * Injected into the worker as STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET so a
 * webapp/automation build can wire Checkout + a signature-verified webhook.
 */
class StripePlugin implements StackPlugin {
  type = PluginType.STRIPE;

  private cfg(config: PluginConfig): StripeConfig {
    return config as unknown as StripeConfig;
  }

  private async get(secretKey: string, path: string): Promise<unknown> {
    const res = await fetch(`${API}${path}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      throw new Error(body?.error?.message ?? `Stripe returned ${res.status}`);
    }
    return res.json();
  }

  async testConnection(config: PluginConfig) {
    const { secretKey } = this.cfg(config);
    if (!secretKey) {
      return { ok: false, error: 'A Stripe secret key is required.' };
    }
    if (!/^(sk|rk)_(test|live)_/.test(secretKey)) {
      return {
        ok: false,
        error: 'That does not look like a Stripe secret key (sk_… / rk_…).',
      };
    }
    try {
      await this.get(secretKey, '/account');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async getStatus(config: PluginConfig): Promise<PluginStatus> {
    const { secretKey, webhookSecret } = this.cfg(config);
    const links = [
      { label: 'Open Stripe', url: 'https://dashboard.stripe.com/' },
    ];

    if (!secretKey) {
      return {
        type: this.type,
        connected: false,
        headline: { label: 'Not connected', state: 'idle' },
        metrics: [],
        links,
      };
    }

    const live = secretKey.includes('_live_');
    const warnings: PluginWarning[] = [];
    if (!live) {
      warnings.push({
        code: 'test-mode',
        severity: 'info',
        label: 'Still in test mode',
        description:
          'This is a test key (sk_test_…). Real payments need a live key.',
      });
    }
    if (!webhookSecret) {
      warnings.push({
        code: 'no-webhook',
        severity: 'warn',
        label: 'No webhook secret',
        description:
          'Add the signing secret (whsec_…) so the app can verify Stripe events.',
        link: {
          label: 'Add webhook',
          url: 'https://dashboard.stripe.com/webhooks',
        },
      });
    }

    try {
      const account = (await this.get(secretKey, '/account')) as {
        settings?: { dashboard?: { display_name?: string } };
        default_currency?: string;
        charges_enabled?: boolean;
      };

      // Last 7 days of successful charges → count + gross.
      const since = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
      const charges = (await this.get(
        secretKey,
        `/charges?limit=100&created[gte]=${since}`,
      )) as { data?: { amount: number; paid: boolean; currency: string }[] };

      const paid = (charges.data ?? []).filter((c) => c.paid);
      const currency = (account.default_currency ?? 'usd').toUpperCase();
      const gross = paid.reduce((s, c) => s + c.amount, 0) / 100;

      const metrics: PluginMetric[] = [
        {
          label: 'Mode',
          value: live ? 'Live' : 'Test',
          state: live ? 'ok' : 'idle',
          section: 'hero',
        },
        {
          label: 'Revenue 7d',
          value: `${gross.toFixed(2)} ${currency}`,
          section: 'hero',
        },
        { label: 'Payments 7d', value: String(paid.length) },
      ];
      if (account.charges_enabled === false) {
        metrics.push({
          label: 'Charges',
          value: 'disabled',
          state: 'warn',
          hint: 'finish onboarding in Stripe to accept payments',
        });
      }

      const name = account.settings?.dashboard?.display_name;
      return {
        type: this.type,
        connected: true,
        headline: {
          label: live ? (name ? `${name} · Live` : 'Live') : 'Test mode',
          state: live ? 'ok' : 'idle',
        },
        metrics,
        warnings: warnings.length ? warnings : undefined,
        links,
      };
    } catch (err) {
      return {
        type: this.type,
        connected: true,
        headline: { label: 'Error', state: 'warn' },
        metrics: [],
        warnings: warnings.length ? warnings : undefined,
        error: (err as Error).message,
        links,
      };
    }
  }
}

pluginRegistry.register(new StripePlugin());
