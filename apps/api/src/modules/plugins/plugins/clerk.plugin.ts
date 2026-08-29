import { PluginType } from '@prisma/client';
import {
  PluginConfig,
  PluginStatus,
  StackPlugin,
  PluginMetric,
  PluginWarning,
} from './plugin.interface';
import { pluginRegistry } from './plugin.registry';

const API = 'https://api.clerk.com/v1';

interface ClerkConfig {
  secretKey: string; // sk_test_… / sk_live_…
  publishableKey?: string; // pk_test_… / pk_live_…
}

/**
 * Clerk plugin (auth). Answers "is login live, how many users, is it still on
 * test keys" without opening the dashboard. Injected into the worker as
 * CLERK_SECRET_KEY / CLERK_PUBLISHABLE_KEY so a webapp build can wire Clerk's
 * middleware + components instead of hand-rolling passwords.
 */
class ClerkPlugin implements StackPlugin {
  type = PluginType.CLERK;

  private cfg(config: PluginConfig): ClerkConfig {
    return config as unknown as ClerkConfig;
  }

  private async get(secretKey: string, path: string): Promise<unknown> {
    const res = await fetch(`${API}${path}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        errors?: { message?: string }[];
      } | null;
      throw new Error(
        body?.errors?.[0]?.message ?? `Clerk returned ${res.status}`,
      );
    }
    return res.json();
  }

  async testConnection(config: PluginConfig) {
    const { secretKey } = this.cfg(config);
    if (!secretKey) {
      return { ok: false, error: 'A Clerk secret key is required.' };
    }
    if (!/^sk_(test|live)_/.test(secretKey)) {
      return {
        ok: false,
        error:
          'That does not look like a Clerk secret key (sk_test_… / sk_live_…).',
      };
    }
    try {
      await this.get(secretKey, '/users/count');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async getStatus(config: PluginConfig): Promise<PluginStatus> {
    const { secretKey, publishableKey } = this.cfg(config);
    const links = [
      { label: 'Open Clerk', url: 'https://dashboard.clerk.com/' },
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
        label: 'Test instance',
        description:
          'These are development keys (sk_test_…). Production login needs live keys.',
      });
    }
    if (!publishableKey) {
      warnings.push({
        code: 'no-publishable',
        severity: 'info',
        label: 'No publishable key',
        description:
          'Add the publishable key (pk_…) so the frontend can mount Clerk.',
      });
    }

    try {
      const count = (await this.get(secretKey, '/users/count')) as {
        total_count?: number;
      };
      // Newest few users → last sign-up as a liveness signal.
      const recent = (await this.get(
        secretKey,
        '/users?limit=1&order_by=-created_at',
      )) as { created_at?: number }[];

      const metrics: PluginMetric[] = [
        {
          label: 'Users',
          value: String(count.total_count ?? 0),
          section: 'hero',
        },
        {
          label: 'Mode',
          value: live ? 'Live' : 'Test',
          state: live ? 'ok' : 'idle',
        },
      ];
      const lastCreated = recent?.[0]?.created_at;
      if (lastCreated) {
        const days = Math.floor(
          (Date.now() - lastCreated) / (24 * 60 * 60 * 1000),
        );
        metrics.push({
          label: 'Newest user',
          value: days <= 0 ? 'today' : `${days}d ago`,
        });
      }

      return {
        type: this.type,
        connected: true,
        headline: {
          label: live ? 'Live' : 'Test instance',
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

pluginRegistry.register(new ClerkPlugin());
