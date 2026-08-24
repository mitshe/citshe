import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { IntegrationStatus, Plugin, PluginType } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/persistence/prisma/prisma.service';
import { EncryptionService } from '../../../shared/encryption/encryption.service';
import { ConnectPluginDto } from '../dto/plugin.dto';
import { pluginRegistry } from '../plugins/plugin.registry';
import { PluginConfig, PluginStatus } from '../plugins/plugin.interface';

// Register the concrete plugins (side-effect imports).
import '../plugins/cloudflare.plugin';
import '../plugins/vercel.plugin';
import '../plugins/neon.plugin';
import '../plugins/google-ads.plugin';
import '../plugins/vps.plugin';
import '../plugins/expo.plugin';
import '../plugins/apple-developer.plugin';

interface CachedStatus {
  status: PluginStatus;
  at: number;
}

const STATUS_TTL_MS = 30_000;

@Injectable()
export class PluginsService {
  private readonly logger = new Logger(PluginsService.name);
  private readonly statusCache = new Map<string, CachedStatus>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  /** List plugins with a lightweight connection summary (no live fetch). */
  async findAll(organizationId: string) {
    const plugins = await this.prisma.plugin.findMany({
      where: { organizationId },
      orderBy: { type: 'asc' },
    });
    return plugins.map((p) => this.toResponse(p));
  }

  /**
   * List connected tools across ALL orgs the user belongs to, so the New-portal
   * wizard can offer "copy from another portal". Grouped by source org. Only
   * CONNECTED plugins/integrations are worth copying.
   */
  async listCopyableConnections(userId: string) {
    const memberships = await this.prisma.organizationMember.findMany({
      where: { userId },
      select: { organizationId: true, organization: { select: { name: true } } },
    });
    const orgIds = memberships.map((m) => m.organizationId);
    if (orgIds.length === 0) return [];

    const [plugins, integrations] = await Promise.all([
      this.prisma.plugin.findMany({
        where: { organizationId: { in: orgIds }, status: 'CONNECTED' },
        select: { organizationId: true, type: true },
      }),
      this.prisma.integration.findMany({
        where: { organizationId: { in: orgIds }, status: 'CONNECTED' },
        select: { organizationId: true, type: true },
      }),
    ]);

    return memberships
      .map((m) => ({
        organizationId: m.organizationId,
        name: m.organization.name,
        tools: [
          ...integrations
            .filter((i) => i.organizationId === m.organizationId)
            .map((i) => i.type as string),
          ...plugins
            .filter((p) => p.organizationId === m.organizationId)
            .map((p) => p.type as string),
        ],
      }))
      .filter((o) => o.tools.length > 0);
  }

  /**
   * Copy connected tools (plugins + GitHub integration) from a source org into
   * the target, so a fresh portal doesn't need reconfiguring from scratch. The
   * encrypted config uses a GLOBAL key, so the ciphertext is copied verbatim —
   * no decrypt/re-encrypt. The user must belong to BOTH orgs. Existing
   * connections in the target are left untouched (upsert = update).
   */
  async copyConnectionsFrom(
    targetOrgId: string,
    sourceOrgId: string,
    userId: string,
  ): Promise<{ copied: number }> {
    if (targetOrgId === sourceOrgId) return { copied: 0 };

    const membership = await this.prisma.organizationMember.findFirst({
      where: { userId, organizationId: sourceOrgId },
      select: { id: true },
    });
    if (!membership) {
      throw new BadRequestException('You do not have access to that portal.');
    }

    const [plugins, integrations] = await Promise.all([
      this.prisma.plugin.findMany({
        where: { organizationId: sourceOrgId, status: 'CONNECTED' },
      }),
      this.prisma.integration.findMany({
        where: { organizationId: sourceOrgId, status: 'CONNECTED' },
      }),
    ]);

    let copied = 0;
    for (const p of plugins) {
      await this.prisma.plugin.upsert({
        where: { organizationId_type: { organizationId: targetOrgId, type: p.type } },
        create: {
          organizationId: targetOrgId,
          type: p.type,
          status: p.status,
          label: p.label,
          config: p.config,
          configIv: p.configIv,
        },
        update: {
          status: p.status,
          config: p.config,
          configIv: p.configIv,
        },
      });
      copied++;
    }
    for (const i of integrations) {
      await this.prisma.integration.upsert({
        where: {
          organizationId_type: { organizationId: targetOrgId, type: i.type },
        },
        create: {
          organizationId: targetOrgId,
          type: i.type,
          status: i.status,
          config: i.config,
          configIv: i.configIv,
        },
        update: {
          status: i.status,
          config: i.config,
          configIv: i.configIv,
        },
      });
      copied++;
    }
    return { copied };
  }

  async connect(organizationId: string, dto: ConnectPluginDto) {
    const type = this.asType(dto.type);
    const config = this.requireConfig(dto.config);

    // Validate before saving so we never store a dead token as "connected".
    const plugin = pluginRegistry.get(type);
    const test = await plugin.testConnection(config);

    const { encrypted, iv } = this.encryption.encryptJson(config);
    const saved = await this.prisma.plugin.upsert({
      where: { organizationId_type: { organizationId, type } },
      create: {
        organizationId,
        type,
        status: test.ok ? IntegrationStatus.CONNECTED : IntegrationStatus.ERROR,
        errorMessage: test.ok ? null : (test.error ?? 'Connection failed'),
        config: new Uint8Array(encrypted),
        configIv: new Uint8Array(iv),
      },
      update: {
        status: test.ok ? IntegrationStatus.CONNECTED : IntegrationStatus.ERROR,
        errorMessage: test.ok ? null : (test.error ?? 'Connection failed'),
        config: new Uint8Array(encrypted),
        configIv: new Uint8Array(iv),
      },
    });

    this.statusCache.delete(saved.id);
    if (!test.ok) {
      throw new BadRequestException(test.error || 'Connection test failed');
    }
    return this.toResponse(saved);
  }

  async remove(organizationId: string, id: string) {
    const plugin = await this.prisma.plugin.findFirst({
      where: { id, organizationId },
    });
    if (!plugin) throw new NotFoundException(`Plugin ${id} not found`);
    this.statusCache.delete(id);
    await this.prisma.plugin.delete({ where: { id } });
  }

  /** Test a config before connecting (the dialog's Test button). */
  async testConfig(dto: ConnectPluginDto) {
    const type = this.asType(dto.type);
    const config = this.requireConfig(dto.config);
    const result = await pluginRegistry.get(type).testConnection(config);
    return {
      success: result.ok,
      message: result.ok ? 'Connection OK' : result.error || 'Failed',
    };
  }

  async testExisting(organizationId: string, id: string) {
    const config = await this.loadConfig(organizationId, id);
    const plugin = await this.prisma.plugin.findFirst({
      where: { id, organizationId },
    });
    if (!plugin) throw new NotFoundException(`Plugin ${id} not found`);
    const result = await pluginRegistry.get(plugin.type).testConnection(config);
    return {
      success: result.ok,
      message: result.ok ? 'Connection OK' : result.error || 'Failed',
    };
  }

  /** Live, normalized status for one plugin type (cached ~30s). */
  async getStatus(
    organizationId: string,
    type: PluginType,
  ): Promise<PluginStatus | null> {
    const plugin = await this.prisma.plugin.findFirst({
      where: { organizationId, type },
    });
    if (!plugin) return null;

    const cached = this.statusCache.get(plugin.id);
    if (cached && Date.now() - cached.at < STATUS_TTL_MS) {
      return cached.status;
    }

    const config = this.decrypt(plugin);
    try {
      const status = await pluginRegistry.get(type).getStatus(config);
      this.statusCache.set(plugin.id, { status, at: Date.now() });
      await this.prisma.plugin.update({
        where: { id: plugin.id },
        data: {
          lastCheckedAt: new Date(),
          status: IntegrationStatus.CONNECTED,
          errorMessage: null,
        },
      });
      return status;
    } catch (err) {
      const message = (err as Error).message;
      this.logger.warn(`Plugin ${type} status failed: ${message}`);
      await this.prisma.plugin.update({
        where: { id: plugin.id },
        data: { status: IntegrationStatus.ERROR, errorMessage: message },
      });
      return {
        type,
        connected: false,
        headline: { label: 'Error', state: 'down' },
        metrics: [],
        error: message,
      };
    }
  }

  /**
   * List the resources a plugin can see (grouped) plus the current selection —
   * powers the "pick which resources matter for this portal" dialog.
   */
  async listResources(organizationId: string, type: PluginType) {
    const plugin = await this.prisma.plugin.findFirst({
      where: { organizationId, type },
    });
    if (!plugin) throw new NotFoundException(`${type} is not connected.`);

    const impl = pluginRegistry.get(type);
    const config = this.decrypt(plugin);
    const groups = impl.listResources ? await impl.listResources(config) : [];
    const selected =
      (config as { selection?: Record<string, unknown> }).selection ?? {};
    return { groups, selected };
  }

  /**
   * Merge a partial config (e.g. { selection }) into a plugin's stored config
   * without touching the token. Busts the status cache.
   */
  async updateConfig(
    organizationId: string,
    type: PluginType,
    partial: Record<string, unknown>,
  ) {
    const plugin = await this.prisma.plugin.findFirst({
      where: { organizationId, type },
    });
    if (!plugin) throw new NotFoundException(`${type} is not connected.`);

    const merged = { ...this.decrypt(plugin), ...partial };
    const { encrypted, iv } = this.encryption.encryptJson(merged);
    await this.prisma.plugin.update({
      where: { id: plugin.id },
      data: { config: new Uint8Array(encrypted), configIv: new Uint8Array(iv) },
    });
    this.statusCache.delete(plugin.id);
    return { ok: true };
  }

  /**
   * Recent preview deployments, optionally filtered to a repo. When `type` is
   * given (a plugin detail page), only that plugin's deployments are returned —
   * so the Cloudflare page never shows Vercel's deploys and vice-versa. Without
   * `type` (e.g. a repo card), we aggregate across all connected deploy plugins.
   */
  async listPreviews(
    organizationId: string,
    repoName?: string,
    type?: PluginType,
  ) {
    // Only Cloudflare + Vercel expose deployments. A DB plugin like Neon has
    // none, so scoping to it (or any non-deploy plugin) yields an empty list.
    const deployTypes: PluginType[] = [
      PluginType.CLOUDFLARE,
      PluginType.VERCEL,
    ];
    const scoped: PluginType[] = type
      ? deployTypes.includes(type)
        ? [type]
        : [] // asked for a specific non-deploy plugin → nothing to show
      : deployTypes;

    if (scoped.length === 0) return [];

    const plugins = await this.prisma.plugin.findMany({
      where: {
        organizationId,
        status: IntegrationStatus.CONNECTED,
        type: { in: scoped },
      },
    });

    const all = await Promise.all(
      plugins.map(async (plugin) => {
        const impl = pluginRegistry.get(plugin.type);
        if (!impl.listPreviews) return [];
        try {
          return await impl.listPreviews(this.decrypt(plugin), repoName);
        } catch (err) {
          this.logger.debug(
            `Previews from ${plugin.type} failed: ${(err as Error).message}`,
          );
          return [];
        }
      }),
    );

    return all
      .flat()
      .sort((a, b) => (b.when ?? '').localeCompare(a.when ?? ''))
      .slice(0, 10);
  }

  /** Run a plugin write-action (redeploy, add subdomain, …). */
  async runAction(
    organizationId: string,
    type: PluginType,
    actionId: string,
    input?: Record<string, unknown>,
  ) {
    const plugin = await this.prisma.plugin.findFirst({
      where: { organizationId, type },
    });
    if (!plugin) throw new NotFoundException(`${type} is not connected.`);

    const impl = pluginRegistry.get(type);
    if (!impl.runAction) {
      throw new BadRequestException(`${type} has no actions.`);
    }

    const config = this.decrypt(plugin);
    const result = await impl.runAction(config, actionId, input);
    // Some actions mutate the plugin's own config (e.g. VPS add/remove server).
    // runAction has no DB access, so when it returns a `config` we re-encrypt
    // and persist it here.
    if (result.config) {
      const { encrypted, iv } = this.encryption.encryptJson(result.config);
      await this.prisma.plugin.update({
        where: { id: plugin.id },
        data: {
          config: new Uint8Array(encrypted),
          configIv: new Uint8Array(iv),
        },
      });
    }
    // The action likely changed things — drop the cached status so the next
    // read is fresh.
    this.statusCache.delete(plugin.id);
    // Never leak the (possibly secret-bearing) config back to the client.
    return { ok: result.ok, message: result.message };
  }

  private asType(type: string): PluginType {
    if (!['CLOUDFLARE', 'VERCEL', 'NEON', 'GOOGLE_ADS', 'VPS'].includes(type)) {
      throw new BadRequestException(`Unknown plugin type: ${type}`);
    }
    return type as PluginType;
  }

  private requireConfig(config: Record<string, unknown>): PluginConfig {
    if (!config || typeof config !== 'object') {
      throw new BadRequestException('Config is required.');
    }
    // Drop empty strings so optional fields stay undefined.
    const clean: PluginConfig = {};
    for (const [k, v] of Object.entries(config)) {
      if (v !== '' && v !== null && v !== undefined) clean[k] = v;
    }
    return clean;
  }

  private async loadConfig(organizationId: string, id: string) {
    const plugin = await this.prisma.plugin.findFirst({
      where: { id, organizationId },
    });
    if (!plugin) throw new NotFoundException(`Plugin ${id} not found`);
    return this.decrypt(plugin);
  }

  private decrypt(plugin: Plugin): PluginConfig {
    return this.encryption.decryptJson<PluginConfig>(
      Buffer.from(plugin.config),
      Buffer.from(plugin.configIv),
    );
  }

  /**
   * Environment variables + a short "how to use it" hint for every connected
   * tool, so a session container can act on the stack directly (wrangler,
   * vercel, neonctl, eas…). Keys are decrypted here and injected as env at
   * container start — the sandbox is one-shot, so this is the CI/CD model.
   * Tools that need more than a token (Apple .p8, per-server SSH) are omitted.
   */
  async getSessionEnv(organizationId: string): Promise<{
    env: Record<string, string>;
    tools: { type: string; hint: string }[];
  }> {
    const plugins = await this.prisma.plugin.findMany({
      where: { organizationId, status: IntegrationStatus.CONNECTED },
    });

    const env: Record<string, string> = {};
    const tools: { type: string; hint: string }[] = [];

    for (const plugin of plugins) {
      let cfg: Record<string, unknown>;
      try {
        cfg = this.decrypt(plugin) as Record<string, unknown>;
      } catch {
        continue;
      }
      const str = (k: string): string | undefined => {
        const v = cfg[k];
        return typeof v === 'string' ? v : undefined;
      };

      switch (plugin.type) {
        case PluginType.CLOUDFLARE: {
          const token = str('apiToken');
          if (!token) break;
          env.CLOUDFLARE_API_TOKEN = token;
          const account = str('accountId');
          if (account) env.CLOUDFLARE_ACCOUNT_ID = account;
          tools.push({
            type: 'Cloudflare',
            hint: 'Use `wrangler` (CLOUDFLARE_API_TOKEN is set) for Pages/Workers/R2/DNS.',
          });
          break;
        }
        case PluginType.VERCEL: {
          const token = str('apiToken');
          if (!token) break;
          env.VERCEL_TOKEN = token;
          const team = str('teamId');
          if (team) env.VERCEL_ORG_ID = team;
          tools.push({
            type: 'Vercel',
            hint: 'Use `vercel --token $VERCEL_TOKEN` for deploys/projects/domains.',
          });
          break;
        }
        case PluginType.NEON: {
          const key = str('apiKey');
          if (!key) break;
          env.NEON_API_KEY = key;
          tools.push({
            type: 'Neon',
            hint: 'Use `neonctl` (NEON_API_KEY is set) for Postgres branches/projects.',
          });
          break;
        }
        case PluginType.EXPO: {
          const token = str('token');
          if (!token) break;
          env.EXPO_TOKEN = token;
          tools.push({
            type: 'Expo',
            hint: 'Use `eas` (EXPO_TOKEN is set) for EAS builds/submits.',
          });
          break;
        }
        case PluginType.GOOGLE_ADS: {
          const dev = str('developerToken');
          if (!dev) break;
          env.GOOGLE_ADS_DEVELOPER_TOKEN = dev;
          const customer = str('customerId');
          if (customer) env.GOOGLE_ADS_CUSTOMER_ID = customer;
          tools.push({
            type: 'Google Ads',
            hint: 'GOOGLE_ADS_* env is set for the Google Ads API (no bundled CLI).',
          });
          break;
        }
        default:
          // APPLE_DEVELOPER (p8 key) / VPS (per-server SSH) need more than a
          // token — skip env injection for those.
          break;
      }
    }

    return { env, tools };
  }

  private toResponse(plugin: Plugin) {
    return {
      id: plugin.id,
      organizationId: plugin.organizationId,
      type: plugin.type,
      status: plugin.status,
      label: plugin.label,
      lastCheckedAt: plugin.lastCheckedAt?.toISOString() ?? null,
      errorMessage: plugin.errorMessage,
      createdAt: plugin.createdAt.toISOString(),
      updatedAt: plugin.updatedAt.toISOString(),
    };
  }
}
