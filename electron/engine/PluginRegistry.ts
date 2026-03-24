/**
 * Plugin Registry — Inspired by any-auto-register plugin system
 * Enables dynamic registration of platform plugins at runtime.
 * Each platform implements BasePlatform and registers itself via @register decorator pattern.
 */

export type ExecutorMode = 'protocol' | 'headless' | 'headed';

export interface PlatformInfo {
  name: string;
  displayName: string;
  version: string;
  supportedExecutors: ExecutorMode[];
  emoji: string;
  color: string;
}

export interface BasePlatformPlugin {
  readonly info: PlatformInfo;
  register(email: string, password?: string, options?: Record<string, any>): Promise<RegisterResult>;
  checkValid(accountId: string): Promise<boolean>;
  getCustomActions?(): PlatformAction[];
}

export interface RegisterResult {
  success: boolean;
  email?: string;
  password?: string;
  token?: string;
  refreshToken?: string;
  apiKey?: string;
  error?: string;
  metadata?: Record<string, any>;
}

export interface PlatformAction {
  id: string;
  label: string;
  description: string;
  handler: (accountId: string, params?: Record<string, any>) => Promise<{ success: boolean; data?: any; error?: string }>;
}

/**
 * Global plugin registry — singleton
 */
class PluginRegistryClass {
  private plugins: Map<string, BasePlatformPlugin> = new Map();

  register(plugin: BasePlatformPlugin): void {
    const name = plugin.info.name.toLowerCase();
    if (this.plugins.has(name)) {
      console.warn(`[PluginRegistry] Overwriting existing plugin: ${name}`);
    }
    this.plugins.set(name, plugin);
    console.log(`[PluginRegistry] Registered: ${plugin.info.displayName} v${plugin.info.version}`);
  }

  get(name: string): BasePlatformPlugin | undefined {
    return this.plugins.get(name.toLowerCase());
  }

  list(): PlatformInfo[] {
    return Array.from(this.plugins.values()).map(p => p.info);
  }

  getAll(): BasePlatformPlugin[] {
    return Array.from(this.plugins.values());
  }

  has(name: string): boolean {
    return this.plugins.has(name.toLowerCase());
  }

  unregister(name: string): boolean {
    return this.plugins.delete(name.toLowerCase());
  }

  /**
   * Get all custom actions from all plugins
   */
  getAllActions(): { platform: string; actions: PlatformAction[] }[] {
    const result: { platform: string; actions: PlatformAction[] }[] = [];
    for (const [name, plugin] of this.plugins) {
      const actions = plugin.getCustomActions?.() || [];
      if (actions.length > 0) {
        result.push({ platform: name, actions });
      }
    }
    return result;
  }
}

export const PluginRegistry = new PluginRegistryClass();

/**
 * Decorator-style registration (used as a function since TS decorators have runtime overhead)
 */
export function registerPlugin(plugin: BasePlatformPlugin): void {
  PluginRegistry.register(plugin);
}
