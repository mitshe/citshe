import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Integration, IntegrationStatus, IntegrationType } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/persistence/prisma/prisma.service';
import { EncryptionService } from '../../../shared/encryption/encryption.service';
import { AdapterFactoryService } from '../../../infrastructure/adapters/adapter-factory.service';
import { CreateIntegrationDto } from '../dto/integration.dto';

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly adapterFactory: AdapterFactoryService,
  ) {}

  async findAll(organizationId: string) {
    const integrations = await this.prisma.integration.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
    return integrations.map((i) => this.toResponse(i));
  }

  async findOne(organizationId: string, id: string) {
    const integration = await this.prisma.integration.findFirst({
      where: { id, organizationId },
    });
    if (!integration) throw new NotFoundException(`Integration ${id} not found`);
    return this.toResponse(integration);
  }

  /** Create/replace an integration from a PAT (the manual, fallback path). */
  async create(organizationId: string, dto: CreateIntegrationDto) {
    const type = this.asType(dto.type);
    const config = this.normalizeConfig(dto.config);

    const { encrypted, iv } = this.encryption.encryptJson(config);

    const integration = await this.prisma.integration.upsert({
      where: { organizationId_type: { organizationId, type } },
      create: {
        organizationId,
        type,
        status: IntegrationStatus.CONNECTED,
        config: new Uint8Array(encrypted),
        configIv: new Uint8Array(iv),
      },
      update: {
        status: IntegrationStatus.CONNECTED,
        errorMessage: null,
        config: new Uint8Array(encrypted),
        configIv: new Uint8Array(iv),
      },
    });

    return this.toResponse(integration);
  }

  /**
   * Save/replace a GitHub App installation as an integration (SSO path).
   * No secret is stored — only the installation id; tokens are minted on demand.
   */
  async saveGithubAppInstallation(
    organizationId: string,
    installationId: string,
  ) {
    const { encrypted, iv } = this.encryption.encryptJson({
      mode: 'app',
      installationId,
    });

    return this.prisma.integration.upsert({
      where: {
        organizationId_type: {
          organizationId,
          type: IntegrationType.GITHUB,
        },
      },
      create: {
        organizationId,
        type: IntegrationType.GITHUB,
        status: IntegrationStatus.CONNECTED,
        config: new Uint8Array(encrypted),
        configIv: new Uint8Array(iv),
      },
      update: {
        status: IntegrationStatus.CONNECTED,
        errorMessage: null,
        config: new Uint8Array(encrypted),
        configIv: new Uint8Array(iv),
      },
    });
  }

  async remove(organizationId: string, id: string) {
    await this.findOne(organizationId, id);
    await this.prisma.integration.delete({ where: { id } });
  }

  /** Test an already-connected integration by hitting the provider. */
  async test(
    organizationId: string,
    id: string,
  ): Promise<{ success: boolean; message: string }> {
    const integration = await this.prisma.integration.findFirst({
      where: { id, organizationId },
    });
    if (!integration) throw new NotFoundException(`Integration ${id} not found`);

    try {
      const provider = await this.adapterFactory.createGitProviderFromIntegration(
        organizationId,
        id,
      );
      const result = await provider.testConnection();
      return {
        success: result.success,
        message: result.success
          ? 'Connection OK'
          : result.error || 'Connection failed',
      };
    } catch (err) {
      return { success: false, message: (err as Error).message };
    }
  }

  /** Test a config before saving (the "Test" button in the connect dialog). */
  async testConfig(
    dto: CreateIntegrationDto,
  ): Promise<{ success: boolean; message: string }> {
    const type = this.asType(dto.type);
    const config = this.normalizeConfig(dto.config);
    try {
      const provider = this.adapterFactory.createGitProvider(type, config);
      const result = await provider.testConnection();
      return {
        success: result.success,
        message: result.success
          ? 'Connection OK'
          : result.error || 'Connection failed',
      };
    } catch (err) {
      return { success: false, message: (err as Error).message };
    }
  }

  private asType(type: string): IntegrationType {
    if (type !== 'GITHUB') {
      throw new BadRequestException(`Unsupported integration type: ${type}`);
    }
    return IntegrationType.GITHUB;
  }

  /** Keep only the fields the GitHub adapter understands. */
  private normalizeConfig(
    config: Record<string, unknown>,
  ): Record<string, unknown> {
    const accessToken =
      (config.accessToken as string) || (config.apiToken as string);
    if (!accessToken) {
      throw new BadRequestException('An access token is required.');
    }
    return { mode: 'pat', accessToken };
  }

  private toResponse(integration: Integration) {
    return {
      id: integration.id,
      type: integration.type,
      status: integration.status,
      organizationId: integration.organizationId,
      lastSyncAt: integration.lastSyncAt?.toISOString() ?? null,
      errorMessage: integration.errorMessage,
      createdAt: integration.createdAt.toISOString(),
      updatedAt: integration.updatedAt.toISOString(),
    };
  }
}
