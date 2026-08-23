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
