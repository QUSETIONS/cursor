/**
 * TokenRefreshService — Inspired by flow2api's AT/ST auto-refresh
 * Manages token lifecycle: automatic refresh before expiry, load balancing across tokens,
 * and health monitoring for all account tokens
 */

import { createLogger } from '../utils/Logger';

export interface ManagedToken {
  id: string;
  platform: string;
  email: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;  // Unix timestamp (ms)
  isValid: boolean;
  lastRefreshedAt?: number;
  lastUsedAt?: number;
  failCount: number;
  metadata?: Record<string, any>;
}

export interface TokenRefreshConfig {
  refreshBeforeExpiryMs: number;     // e.g. 300000 = refresh 5 min before expiry
  healthCheckIntervalMs: number;     // e.g. 600000 = check every 10 min
  maxRefreshRetries: number;         // Max retries per refresh attempt
  loadBalanceStrategy: 'round-robin' | 'random' | 'least-used';
}

const DEFAULT_CONFIG: TokenRefreshConfig = {
  refreshBeforeExpiryMs: 300000,
  healthCheckIntervalMs: 600000,
  maxRefreshRetries: 3,
  loadBalanceStrategy: 'round-robin',
};

export class TokenRefreshService {
  private tokens: Map<string, ManagedToken> = new Map();
  private config: TokenRefreshConfig;
  private refreshTimer?: NodeJS.Timeout;
  private rrIndex = 0;
  private log = createLogger('TokenRefresh');
  private refreshHandlers: Map<string, TokenRefreshHandler> = new Map();

  constructor(config?: Partial<TokenRefreshConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─── Lifecycle ───

  start(): void {
    this.refreshTimer = setInterval(() => {
      this.checkAndRefreshAll();
    }, this.config.healthCheckIntervalMs);
    this.log.info('Token refresh service started');
  }

  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    this.log.info('Token refresh service stopped');
  }

  // ─── Register refresh handler per platform ───

  registerRefreshHandler(platform: string, handler: TokenRefreshHandler): void {
    this.refreshHandlers.set(platform, handler);
    this.log.info(`Registered refresh handler for ${platform}`);
  }

  // ─── Token Management ───

  addToken(token: ManagedToken): void {
    this.tokens.set(token.id, token);
    this.log.info(`Added token: ${token.email} (${token.platform})`);
  }

  removeToken(id: string): boolean {
    return this.tokens.delete(id);
  }

  getToken(id: string): ManagedToken | undefined {
    return this.tokens.get(id);
  }

  /**
   * Get next available token for a platform (load-balanced)
   */
  getNextToken(platform: string): ManagedToken | null {
    const available = Array.from(this.tokens.values()).filter(
      t => t.platform === platform && t.isValid
    );
    if (available.length === 0) return null;

    let picked: ManagedToken;
    switch (this.config.loadBalanceStrategy) {
      case 'round-robin':
        this.rrIndex = this.rrIndex % available.length;
        picked = available[this.rrIndex++];
        break;
      case 'random':
        picked = available[Math.floor(Math.random() * available.length)];
        break;
      case 'least-used':
        picked = available.sort((a, b) => (a.lastUsedAt || 0) - (b.lastUsedAt || 0))[0];
        break;
    }

    picked.lastUsedAt = Date.now();
    return picked;
  }

  // ─── Auto-Refresh ───

  private async checkAndRefreshAll(): Promise<void> {
    const now = Date.now();
    const tokensToRefresh: ManagedToken[] = [];

    for (const token of this.tokens.values()) {
      if (!token.isValid || !token.refreshToken) continue;

      // Check if token is about to expire
      if (token.expiresAt && token.expiresAt - now < this.config.refreshBeforeExpiryMs) {
        tokensToRefresh.push(token);
      }
    }

    if (tokensToRefresh.length > 0) {
      this.log.info(`Refreshing ${tokensToRefresh.length} tokens...`);
    }

    for (const token of tokensToRefresh) {
      await this.refreshToken(token);
    }
  }

  private async refreshToken(token: ManagedToken): Promise<boolean> {
    const handler = this.refreshHandlers.get(token.platform);
    if (!handler) {
      this.log.warn(`No refresh handler for ${token.platform}`);
      return false;
    }

    for (let attempt = 0; attempt < this.config.maxRefreshRetries; attempt++) {
      try {
        const result = await handler(token);
        if (result.success) {
          token.accessToken = result.accessToken!;
          if (result.refreshToken) token.refreshToken = result.refreshToken;
          if (result.expiresAt) token.expiresAt = result.expiresAt;
          token.lastRefreshedAt = Date.now();
          token.failCount = 0;
          token.isValid = true;
          this.log.info(`Refreshed: ${token.email}`);
          return true;
        }
      } catch (err) {
        this.log.error(`Refresh attempt ${attempt + 1} failed for ${token.email}:`, err);
      }
    }

    // All retries failed
    token.failCount++;
    if (token.failCount >= 3) {
      token.isValid = false;
      this.log.warn(`Token disabled after ${token.failCount} refresh failures: ${token.email}`);
    }
    return false;
  }

  // ─── Stats ───

  getStats(platform?: string): {
    total: number;
    valid: number;
    invalid: number;
    expiringSoon: number;
  } {
    const all = Array.from(this.tokens.values()).filter(
      t => !platform || t.platform === platform
    );
    const now = Date.now();

    return {
      total: all.length,
      valid: all.filter(t => t.isValid).length,
      invalid: all.filter(t => !t.isValid).length,
      expiringSoon: all.filter(t =>
        t.isValid && t.expiresAt && t.expiresAt - now < this.config.refreshBeforeExpiryMs * 2
      ).length,
    };
  }

  listTokens(platform?: string): ManagedToken[] {
    const all = Array.from(this.tokens.values());
    return platform ? all.filter(t => t.platform === platform) : all;
  }
}

export type TokenRefreshHandler = (token: ManagedToken) => Promise<{
  success: boolean;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  error?: string;
}>;
