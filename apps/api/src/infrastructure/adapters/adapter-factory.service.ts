import { Injectable, Logger } from '@nestjs/common';
import { IntegrationType, IntegrationStatus, AIProvider } from '@prisma/client';
import { PrismaService } from '../persistence/prisma/prisma.service';
import { EncryptionService } from '../../shared/encryption/encryption.service';
import { GitProviderPort } from '../../ports/git-provider.port';
import { AIProviderPort } from '../../ports/ai-provider.port';

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
  ) {}

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
      throw new Error(
        `Integration ${integrationId} not found or not connected`,
      );
    }

    const decryptedConfig = this.encryptionService.decryptJson<AdapterConfig>(
      Buffer.from(integration.config),
      Buffer.from(integration.configIv),
    );

    return this.createGitProvider(integration.type, decryptedConfig);
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
    organizationId: string,
    credentialId: string,
  ): Promise<AIProviderPort> {
    const credential = await this.prisma.aICredential.findFirst({
      where: {
        id: credentialId,
        organizationId,
      },
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
   * Find the default AI provider for an organization
   */
  async getDefaultAIProvider(
    organizationId: string,
  ): Promise<AIProviderPort | null> {
    const credential = await this.prisma.aICredential.findFirst({
      where: {
        organizationId,
        isDefault: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    if (!credential) {
      const firstCredential = await this.prisma.aICredential.findFirst({
        where: { organizationId },
        orderBy: { createdAt: 'asc' },
      });

      if (!firstCredential) {
        return null;
      }

      return this.createAIProviderFromCredential(
        organizationId,
        firstCredential.id,
      );
    }

    return this.createAIProviderFromCredential(organizationId, credential.id);
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
