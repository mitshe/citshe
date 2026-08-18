/**
 * AI Provider Adapter Registrations
 * Register all AI provider adapters with the registry
 */

import { aiProviderRegistry, AdapterConfig } from '../adapter-registry';
import { createClaudeAdapter } from '../ai-provider/claude.adapter';
import { createClaudeCodeLocalAdapter } from '../ai-provider/claude-code-local.adapter';

// Register Claude adapter
aiProviderRegistry.register('CLAUDE', (config: AdapterConfig) =>
  createClaudeAdapter({
    apiKey: config.apiKey || '',
    defaultModel: config.defaultModel,
  }),
);

// Register Claude Code Local adapter
aiProviderRegistry.register('CLAUDE_CODE_LOCAL', () =>
  createClaudeCodeLocalAdapter(),
);
