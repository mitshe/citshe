import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { IntegrationType, IntegrationStatus, AIProvider } from '@prisma/client';
import { PrismaService } from '../persistence/prisma/prisma.service';
import { EncryptionService } from '../../shared/encryption/encryption.service';
import { GitProviderPort } from '../../ports/git-provider.port';
import { AIProviderPort } from '../../ports/ai-provider.port';
import { GithubAppService } from './git-provider/github-app.service';

// Import registrations to ensure adapters are registered
import './registrations';

import {
  AdapterConfig,
  gitProviderRegistry,
  aiProviderRegistry,
  isGitProviderType,
} from './adapter-registry';

export { AdapterConfig } from './adapter-registry';

@Injectable()
export class AdapterFactoryService {
  private readonly logger = new Logger(AdapterFactoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryptionService: EncryptionService,
    private readonly githubApp: GithubAppService,
  ) {}

  /**
   * Resolve a config to a usable adapter config. For GitHub App integrations
   * (mode:'app') this mints a fresh installation access token and hands it to
   * the adapter as accessToken — so the rest of the code is App-agnostic.
   */
  private async resolveGitConfig(
    config: AdapterConfig,
  ): Promise<AdapterConfig> {
    if (config.mode === 'app' && config.installationId) {
      const accessToken = await this.githubApp.getInstallationToken(
        String(config.installationId),
      );
      return { ...config, accessToken };
    }
    return config;
  }

  /**
   * Test connection for an integration
   */
  async testIntegrationConnection(
    type: IntegrationType | string,
    config: AdapterConfig,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const typeStr = String(type).toUpperCase();

      if (isGitProviderType(typeStr)) {
        const adapter = this.createGitProvider(type, config);
        return await adapter.testConnection();
      }

      return { success: false, error: `Unknown integration type: ${type}` };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  // ========== Git Provider Methods ==========

  /**
   * Create a git provider adapter from an integration ID
   */
  async createGitProviderFromIntegration(
    organizationId: string,
    integrationId: string,
  ): Promise<GitProviderPort> {
    const integration = await this.prisma.integration.findFirst({
      where: {
        id: integrationId,
        organizationId,
        status: IntegrationStatus.CONNECTED,
      },
    });

    if (!integration) {
      throw new BadRequestException(
        `Integration ${integrationId} not found or not connected`,
      );
    }

    const decryptedConfig = this.encryptionService.decryptJson<AdapterConfig>(
      Buffer.from(integration.config),
      Buffer.from(integration.configIv),
    );

    const config = await this.resolveGitConfig(decryptedConfig);
    return this.createGitProvider(integration.type, config);
  }

  /**
   * Create a git provider adapter from config
   */
  createGitProvider(
    type: IntegrationType | string,
    config: AdapterConfig,
  ): GitProviderPort {
    return gitProviderRegistry.create(String(type), config);
  }

  /**
   * Find the default git provider for an organization
   */
  async getDefaultGitProvider(
    organizationId: string,
  ): Promise<GitProviderPort | null> {
    const integration = await this.prisma.integration.findFirst({
      where: {
        organizationId,
        type: IntegrationType.GITHUB,
        status: IntegrationStatus.CONNECTED,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    if (!integration) {
      return null;
    }

    return this.createGitProviderFromIntegration(
      organizationId,
      integration.id,
    );
  }

  // ========== AI Provider Methods ==========

  /**
   * Create an AI provider from an AI credential ID
   */
  async createAIProviderFromCredential(
    // Kept for signature compatibility; AI credentials are a SERVER-WIDE pool
    // (like the Claude engine on subscription), so the key is resolved by id
    // alone — not scoped to the calling org. GitHub/Cloudflare/etc. stay
    // per-portal, only AI keys are shared.
    _organizationId: string,
    credentialId: string,
  ): Promise<AIProviderPort> {
    const credential = await this.prisma.aICredential.findUnique({
      where: { id: credentialId },
    });

    if (!credential) {
      throw new Error(`AI Credential ${credentialId} not found`);
    }

    const apiKey = this.encryptionService.decrypt(
      Buffer.from(credential.encryptedKey),
      Buffer.from(credential.keyIv),
    );

    return this.createAIProvider(credential.provider, { apiKey });
  }

  /**
   * Create an AI provider from config
   */
  createAIProvider(
    type: AIProvider | string,
    config: {
      apiKey: string;
      defaultModel?: string;
      baseUrl?: string;
      organization?: string;
    },
  ): AIProviderPort {
    return aiProviderRegistry.create(String(type), config);
  }

  /**
   * Resolve the AI provider for a request. AI credentials are SERVER-WIDE (one
   * key powers Improve-with-AI, refine and repo analysis across ALL portals),
   * so this prefers the org's own key if it has one, then falls back to any key
   * on the server. Returns null only when the server has NO AI key at all.
   */
  async getDefaultAIProvider(
    organizationId: string,
  ): Promise<AIProviderPort | null> {
    // 1. The org's own key (default first, then oldest) — lets a portal pin a
    //    specific key if it wants, without breaking the shared model.
    const own = await this.prisma.aICredential.findFirst({
      where: { organizationId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    if (own) return this.createAIProviderFromCredential(organizationId, own.id);

    // 2. Fall back to ANY key on the server (shared pool).
    return this.getServerAIProvider();
  }

  /**
   * Resolve any AI provider on the server, ignoring org entirely. Use from
   * places that have no org context yet (e.g. the new-project wizard). Picks the
   * server-wide default first, then the oldest key. Null if none exist.
   */
  async getServerAIProvider(): Promise<AIProviderPort | null> {
    const credential = await this.prisma.aICredential.findFirst({
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    if (!credential) return null;
    return this.createAIProviderFromCredential(
      credential.organizationId,
      credential.id,
    );
  }

  /**
   * Get AI provider by provider type for an organization
   */
  async getAIProviderByType(
    organizationId: string,
    providerType: AIProvider,
  ): Promise<AIProviderPort | null> {
    const credential = await this.prisma.aICredential.findFirst({
      where: {
        organizationId,
        provider: providerType,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    if (!credential) {
      return null;
    }

    return this.createAIProviderFromCredential(organizationId, credential.id);
  }

  /**
   * Get all AI providers for an organization
   */
  async getAllAIProviders(organizationId: string): Promise<AIProviderPort[]> {
    const credentials = await this.prisma.aICredential.findMany({
      where: {
        organizationId,
      },
    });

    const providers: AIProviderPort[] = [];

    for (const credential of credentials) {
      try {
        const provider = await this.createAIProviderFromCredential(
          organizationId,
          credential.id,
        );
        providers.push(provider);
      } catch (error) {
        this.logger.warn(
          `Failed to create AI provider for ${credential.id}: ${(error as Error).message}`,
        );
      }
    }

    return providers;
  }

  /**
   * Test AI provider connection
   */
  async testAIProviderConnection(
    type: AIProvider | string,
    config: {
      apiKey: string;
      defaultModel?: string;
      baseUrl?: string;
      organization?: string;
    },
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const provider = this.createAIProvider(type, config);
      return await provider.testConnection();
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  // ========== Registry Info Methods ==========

  /**
   * Get available git provider types
   */
  getAvailableGitProviderTypes(): string[] {
    return gitProviderRegistry.getAvailableTypes();
  }

  /**
   * Get available AI provider types
   */
  getAvailableAIProviderTypes(): string[] {
    return aiProviderRegistry.getAvailableTypes();
  }
}
