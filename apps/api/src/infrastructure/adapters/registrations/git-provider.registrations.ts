/**
 * Git Provider Adapter Registrations
 * Register all git provider adapters with the registry
 */

import { gitProviderRegistry, AdapterConfig } from '../adapter-registry';
import { createGitHubAdapter } from '../git-provider/github.adapter';

// Register GitHub adapter
gitProviderRegistry.register('GITHUB', (config: AdapterConfig) =>
  createGitHubAdapter({
    baseUrl: config.baseUrl,
    accessToken: config.accessToken || config.apiToken || '',
  }),
);
