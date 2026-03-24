/**
 * ResinProxyService — Integrates with Resin proxy gateway
 * https://github.com/Resinat/Resin
 *
 * Resin turns massive proxy subscriptions into a stable, smart proxy pool
 * with sticky sessions (same account → same outbound IP).
 */

import { createLogger } from '../utils/Logger';

export interface ResinConfig {
  host: string;          // Resin gateway host (default: 127.0.0.1)
  proxyPort: number;     // HTTP proxy port (default: 2260)
  uiPort: number;        // Web UI port (default: 2261)
  proxyToken: string;    // RESIN_PROXY_TOKEN
  defaultPlatform: string; // Platform name (default: 'Default')
}

export interface ResinProxyInfo {
  proxyUrl: string;      // Full proxy URL for Puppeteer
  account: string;       // Account ID used for sticky session
  platform: string;      // Platform this proxy belongs to
}

const DEFAULT_CONFIG: ResinConfig = {
  host: '127.0.0.1',
  proxyPort: 2260,
  uiPort: 2261,
  proxyToken: 'nirvana-secret',
  defaultPlatform: 'Default',
};

export class ResinProxyService {
  private log = createLogger('ResinProxy');
  private config: ResinConfig;
  private activeLeases: Map<string, ResinProxyInfo> = new Map();

  constructor(config?: Partial<ResinConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.log.info(`Resin proxy service initialized → ${this.config.host}:${this.config.proxyPort}`);
  }

  /**
   * Get a sticky proxy for a specific registration task.
   * The same taskId will always route through the same outbound IP.
   */
  getProxy(taskId: string, platform?: string): ResinProxyInfo {
    const existing = this.activeLeases.get(taskId);
    if (existing) return existing;

    const plat = platform || this.config.defaultPlatform;
    const account = `task_${taskId}`;

    // Resin V1 auth format: Platform.Account:Token
    const proxyUrl = `http://${plat}.${account}:${this.config.proxyToken}@${this.config.host}:${this.config.proxyPort}`;

    const info: ResinProxyInfo = { proxyUrl, account, platform: plat };
    this.activeLeases.set(taskId, info);
    this.log.info(`Leased sticky proxy for ${taskId} → platform=${plat}`);
    return info;
  }

  /**
   * Get a rotating (non-sticky) proxy for one-off requests.
   * Uses DEFAULT_ROTATING as account so Resin picks a random node each time.
   */
  getRotatingProxy(): string {
    const randomId = Math.random().toString(36).slice(2, 10);
    return `http://${this.config.defaultPlatform}.rot_${randomId}:${this.config.proxyToken}@${this.config.host}:${this.config.proxyPort}`;
  }

  /**
   * Release a sticky lease (allows Resin to reassign the IP).
   */
  releaseLease(taskId: string): void {
    this.activeLeases.delete(taskId);
    this.log.info(`Released sticky proxy lease for ${taskId}`);
  }

  /**
   * Check if Resin gateway is reachable.
   */
  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`http://${this.config.host}:${this.config.uiPort}/api/health`, {
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Import a subscription URL into Resin via its API.
   */
  async importSubscription(subscriptionUrl: string, name?: string): Promise<boolean> {
    try {
      const res = await fetch(`http://${this.config.host}:${this.config.uiPort}/api/subscriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name || `sub_${Date.now()}`,
          url: subscriptionUrl,
        }),
      });
      if (res.ok) {
        this.log.info(`Imported subscription: ${subscriptionUrl}`);
        return true;
      }
      this.log.warn(`Failed to import subscription: ${res.status}`);
      return false;
    } catch (err) {
      this.log.error('Subscription import error:', err);
      return false;
    }
  }

  /**
   * Get current Resin stats (node count, health, etc.)
   */
  async getStats(): Promise<any> {
    try {
      const res = await fetch(`http://${this.config.host}:${this.config.uiPort}/api/stats`);
      return await res.json();
    } catch {
      return null;
    }
  }

  /**
   * Get active leases count.
   */
  getActiveLeaseCount(): number {
    return this.activeLeases.size;
  }

  /**
   * Generate Puppeteer proxy args for a given task.
   */
  getPuppeteerArgs(taskId: string, platform?: string): string[] {
    const info = this.getProxy(taskId, platform);
    // Parse the proxy URL into host:port for Puppeteer
    const url = new URL(info.proxyUrl);
    return [`--proxy-server=${url.protocol}//${url.hostname}:${url.port}`];
  }
}

export const resinProxy = new ResinProxyService();
