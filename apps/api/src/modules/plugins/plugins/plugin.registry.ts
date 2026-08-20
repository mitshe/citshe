import { PluginType } from '@prisma/client';
import { StackPlugin } from './plugin.interface';

/**
 * Registry of stack plugins. Each plugin registers itself once; the service
 * resolves an instance by type. Mirrors the git-provider registry pattern.
 */
class PluginRegistry {
  private readonly plugins = new Map<PluginType, StackPlugin>();

  register(plugin: StackPlugin): void {
    this.plugins.set(plugin.type, plugin);
  }

  get(type: PluginType): StackPlugin {
    const plugin = this.plugins.get(type);
    if (!plugin) throw new Error(`No plugin registered for type: ${type}`);
    return plugin;
  }

  has(type: PluginType): boolean {
    return this.plugins.has(type);
  }
}

export const pluginRegistry = new PluginRegistry();
