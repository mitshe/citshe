import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/persistence/prisma/prisma.service';
import { EncryptionService } from '../../../shared/encryption/encryption.service';
import { AdapterFactoryService } from '../../../infrastructure/adapters/adapter-factory.service';
import {
  CreateAICredentialDto,
  UpdateAICredentialDto,
} from '../dto/ai-credential.dto';
import { AIProvider, Prisma } from '@prisma/client';

@Injectable()
export class AICredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly adapterFactory: AdapterFactoryService,
  ) {}

  // AI credentials are a SERVER-WIDE pool (one key powers Improve-with-AI,
  // refine and repo analysis across ALL portals). The `organizationId` on a row
  // is only a storage anchor (the portal it was added from) — reads and CRUD
  // operate on the whole pool, and `isDefault` is a single server-wide default.
  async create(organizationId: string, dto: CreateAICredentialDto) {
    // Encrypt API key
    const { encrypted, iv } = this.encryption.encrypt(dto.apiKey);

    try {
      // Use transaction to atomically handle isDefault flag
      // This prevents race conditions when multiple credentials are created
      const credential = await this.prisma.$transaction(async (tx) => {
        // If this is set as default, unset the default on ALL keys (server-wide).
        if (dto.isDefault) {
          await tx.aICredential.updateMany({
            where: { isDefault: true },
            data: { isDefault: false },
          });
        }

        return tx.aICredential.create({
          data: {
            organizationId,
            provider: dto.provider,
            encryptedKey: new Uint8Array(encrypted),
            keyIv: new Uint8Array(iv),
            isDefault: dto.isDefault ?? false,
          },
        });
      });

      return this.toResponse(credential, dto.apiKey);
    } catch (error) {
      // P2002 is Prisma's unique constraint violation code
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          `AI credential for ${dto.provider} already exists`,
        );
      }
      throw error;
    }
  }

  // Server-wide pool: list every AI key regardless of the portal it was added
  // from. (organizationId param kept for signature/controller compatibility.)
  async findAll(_organizationId: string) {
    const credentials = await this.prisma.aICredential.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return credentials.map((c) => this.toResponse(c));
  }

  async findOne(_organizationId: string, id: string) {
    const credential = await this.prisma.aICredential.findUnique({
      where: { id },
    });

    if (!credential) {
      throw new NotFoundException(`AI credential ${id} not found`);
    }

    return this.toResponse(credential);
  }

  async update(
    _organizationId: string,
    id: string,
    dto: UpdateAICredentialDto,
  ) {
    // Prepare update data
    const data: any = {};

    if (dto.apiKey) {
      const { encrypted, iv } = this.encryption.encrypt(dto.apiKey);
      data.encryptedKey = encrypted;
      data.keyIv = iv;
    }

    if (dto.isDefault !== undefined) {
      data.isDefault = dto.isDefault;
    }

    // Use transaction to atomically handle isDefault flag changes
    // This prevents race conditions when multiple updates set isDefault
    const updated = await this.prisma.$transaction(async (tx) => {
      const credential = await tx.aICredential.findUnique({
        where: { id },
      });

      if (!credential) {
        throw new NotFoundException(`AI credential ${id} not found`);
      }

      // If setting this as default, unset the default on ALL other keys.
      if (dto.isDefault === true) {
        await tx.aICredential.updateMany({
          where: { id: { not: id }, isDefault: true },
          data: { isDefault: false },
        });
      }

      return tx.aICredential.update({
        where: { id },
        data,
      });
    });

    return this.toResponse(updated, dto.apiKey);
  }

  async remove(_organizationId: string, id: string) {
    const credential = await this.prisma.aICredential.findUnique({
      where: { id },
    });

    if (!credential) {
      throw new NotFoundException(`AI credential ${id} not found`);
    }

    return this.prisma.aICredential.delete({ where: { id } });
  }

  // =========================================================================
  // Connection Testing
  // =========================================================================

  async testConnection(
    _organizationId: string,
    id: string,
  ): Promise<{ success: boolean; message: string }> {
    const credential = await this.prisma.aICredential.findUnique({
      where: { id },
    });

    if (!credential) {
      throw new NotFoundException(`AI credential ${id} not found`);
    }

    const apiKey = this.encryption.decrypt(
      Buffer.from(credential.encryptedKey),
      Buffer.from(credential.keyIv),
    );

    const result = await this.adapterFactory.testAIProviderConnection(
      credential.provider,
      { apiKey },
    );

    return {
      success: result.success,
      message: result.success
        ? 'Connection successful'
        : result.error || 'Connection failed',
    };
  }

  /**
   * Fetch the credit balance for a credential. Only OpenRouter exposes a
   * simple balance endpoint; for any other provider this returns null.
   * Resilient: adapter failures surface as null, never as thrown errors.
   */
  async getCredits(
    organizationId: string,
    id: string,
  ): Promise<{
    totalCredits: number;
    totalUsage: number;
    remaining: number;
  } | null> {
    const credential = await this.prisma.aICredential.findUnique({
      where: { id },
    });

    if (!credential) {
      throw new NotFoundException(`AI credential ${id} not found`);
    }

    // Only OpenRouter has a credits endpoint; others aren't supported.
    if (credential.provider !== AIProvider.OPENROUTER) {
      return null;
    }

    try {
      const adapter = await this.adapterFactory.createAIProviderFromCredential(
        organizationId,
        id,
      );

      if (typeof adapter.getCredits !== 'function') {
        return null;
      }

      return await adapter.getCredits();
    } catch {
      // Never let a credits lookup break the caller.
      return null;
    }
  }

  async testBeforeConnect(
    provider: AIProvider,
    apiKey?: string,
  ): Promise<{ success: boolean; message: string }> {
    const result = await this.adapterFactory.testAIProviderConnection(
      provider,
      {
        apiKey: apiKey || 'local',
      },
    );

    return {
      success: result.success,
      message: result.success
        ? 'Connection successful'
        : result.error || 'Connection failed',
    };
  }

  // =========================================================================
  // Internal Methods (for AI adapters)
  // =========================================================================

  /**
   * Get decrypted API key for a provider (internal use only)
   */
  async getApiKey(
    organizationId: string,
    provider: AIProvider,
  ): Promise<string | null> {
    const credential = await this.prisma.aICredential.findFirst({
      where: { organizationId, provider },
    });

    if (!credential) {
      return null;
    }

    // Update usage stats
    await this.prisma.aICredential.update({
      where: { id: credential.id },
      data: {
        lastUsedAt: new Date(),
        usageCount: { increment: 1 },
      },
    });

    return this.encryption.decrypt(
      Buffer.from(credential.encryptedKey),
      Buffer.from(credential.keyIv),
    );
  }

  /**
   * Get default AI provider's API key
   */
  async getDefaultApiKey(organizationId: string): Promise<{
    provider: AIProvider;
    apiKey: string;
  } | null> {
    const credential = await this.prisma.aICredential.findFirst({
      where: { organizationId, isDefault: true },
    });

    if (!credential) {
      // Fall back to first available
      const firstCredential = await this.prisma.aICredential.findFirst({
        where: { organizationId },
      });

      if (!firstCredential) {
        return null;
      }

      const apiKey = this.encryption.decrypt(
        Buffer.from(firstCredential.encryptedKey),
        Buffer.from(firstCredential.keyIv),
      );

      return { provider: firstCredential.provider, apiKey };
    }

    // Update usage stats
    await this.prisma.aICredential.update({
      where: { id: credential.id },
      data: {
        lastUsedAt: new Date(),
        usageCount: { increment: 1 },
      },
    });

    const apiKey = this.encryption.decrypt(
      Buffer.from(credential.encryptedKey),
      Buffer.from(credential.keyIv),
    );

    return { provider: credential.provider, apiKey };
  }

  // =========================================================================
  // Helper Methods
  // =========================================================================

  private toResponse(credential: any, originalKey?: string) {
    let maskedKey: string;
    try {
      maskedKey = originalKey
        ? this.maskApiKey(originalKey)
        : this.maskApiKey(
            this.encryption.decrypt(
              Buffer.from(credential.encryptedKey),
              Buffer.from(credential.keyIv),
            ),
          );
    } catch {
      maskedKey = '****...****';
    }

    return {
      id: credential.id,
      organizationId: credential.organizationId,
      provider: credential.provider,
      isDefault: credential.isDefault,
      lastUsedAt: credential.lastUsedAt,
      usageCount: credential.usageCount,
      createdAt: credential.createdAt,
      updatedAt: credential.updatedAt,
      maskedKey,
    };
  }

  private maskApiKey(key: string): string {
    if (key.length <= 8) {
      return '****';
    }
    return `${key.substring(0, 4)}...${key.substring(key.length - 4)}`;
  }
}
