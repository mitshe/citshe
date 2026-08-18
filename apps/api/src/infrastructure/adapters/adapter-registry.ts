/**
 * Adapter Registry - Registry pattern for adapter creation (OCP compliant)
 *
 * Instead of switch statements, adapters register their creator functions.
 * New adapters can be added without modifying existing code.
 */

import { GitProviderPort } from '../../ports/git-provider.port';
import { AIProviderPort } from '../../ports/ai-provider.port';

export interface AdapterConfig {
  baseUrl?: string;
  email?: string;
  apiToken?: string;
  apiKey?: string;
  accessToken?: string;
  tokenType?: string;
  botToken?: string;
  webhookUrl?: string;
  botName?: string;
  iconEmoji?: string;
  defaultModel?: string;
  organization?: string;
  insecure?: boolean;
  username?: string;
  avatarUrl?: string;
  defaultChatId?: string;
  [key: string]: unknown;
}

// Generic adapter creator type
type AdapterCreator<T> = (config: AdapterConfig) => T;

/**
 * Type-safe adapter registry
 */
class AdapterRegistry<T> {
  private creators = new Map<string, AdapterCreator<T>>();
  private readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  register(type: string, creator: AdapterCreator<T>): void {
    this.creators.set(type.toUpperCase(), creator);
  }

  has(type: string): boolean {
    return this.creators.has(type.toUpperCase());
  }

  create(type: string, config: AdapterConfig): T {
    const creator = this.creators.get(type.toUpperCase());
    if (!creator) {
      throw new Error(
        `Unknown ${this.name} type: ${type}. Available: ${this.getAvailableTypes().join(', ')}`,
      );
    }
    return creator(config);
  }

  getAvailableTypes(): string[] {
    return Array.from(this.creators.keys());
  }
}

// Singleton registries for each adapter type
export const gitProviderRegistry = new AdapterRegistry<GitProviderPort>(
  'git provider',
);
export const aiProviderRegistry = new AdapterRegistry<AIProviderPort>(
  'AI provider',
);

// Git provider types
export const GIT_PROVIDER_TYPES = ['GITHUB'] as const;
export type GitProviderType = (typeof GIT_PROVIDER_TYPES)[number];

// AI provider types
export const AI_PROVIDER_TYPES = ['CLAUDE', 'CLAUDE_CODE_LOCAL'] as const;
export type AIProviderType = (typeof AI_PROVIDER_TYPES)[number];

// Type guards
export function isGitProviderType(type: string): type is GitProviderType {
  return GIT_PROVIDER_TYPES.includes(type.toUpperCase() as GitProviderType);
}

export function isAIProviderType(type: string): type is AIProviderType {
  return AI_PROVIDER_TYPES.includes(type.toUpperCase() as AIProviderType);
}
