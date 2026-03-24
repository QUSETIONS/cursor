import { createLogger } from '../utils/Logger';
import { AccountPoolService } from './AccountPoolService';
import { ProxyPoolService } from './ProxyPoolService';
import os from 'node:os';

export interface WatchdogConfig {
  intervalMs: number;
  alertWebhookUrl?: string; // Optional Discord/Slack webhook
  lowProxyThreshold: number;
  lowAccountThreshold: number;
  maxMemoryMb: number;
}

export class WatchdogService {
  private log = createLogger('Watchdog');
  private timer?: NodeJS.Timeout;
  private config: WatchdogConfig;
  private accountPool: AccountPoolService;
  private proxyPool: ProxyPoolService;

  constructor(
    accountPool: AccountPoolService,
    proxyPool: ProxyPoolService,
    config?: Partial<WatchdogConfig>
  ) {
    this.accountPool = accountPool;
    this.proxyPool = proxyPool;
    this.config = {
      intervalMs: 60000, // Check every 1 min
      lowProxyThreshold: 10,
      lowAccountThreshold: 5,
      maxMemoryMb: 1500, // 1.5GB
      ...config,
    };
  }

  start(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.checkHealth(), this.config.intervalMs);
    this.log.info('Watchdog telemetry service started');
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async checkHealth(): Promise<void> {
    try {
      const memoryUsage = process.memoryUsage().rss / 1024 / 1024;
      const proxyStats = this.proxyPool.getStats();
      const accountsCount = this.accountPool.list({ platform: 'cursor', status: 'active' }).length;

      const alerts: string[] = [];

      // Memory check
      if (memoryUsage > this.config.maxMemoryMb) {
        alerts.push(`🚨 CRITICAL: Node RSS memory exceeds ${this.config.maxMemoryMb}MB (Current: ${memoryUsage.toFixed(1)}MB)`);
      }

      // Proxy check
      if (proxyStats.healthy < this.config.lowProxyThreshold) {
        alerts.push(`⚠️ WARNING: Healthy proxy count critically low (${proxyStats.healthy} remaining)`);
      }

      // Account token check
      if (accountsCount < this.config.lowAccountThreshold) {
        alerts.push(`⚠️ WARNING: Available cursor bypass accounts critically low (${accountsCount} remaining)`);
      }

      if (alerts.length > 0) {
        this.log.warn('Watchdog triggered alerts:\n' + alerts.join('\n'));
        await this.fireWebhook(alerts);
      }
    } catch (e) {
      this.log.error('Watchdog health check failed:', e);
    }
  }

  private async fireWebhook(alerts: string[]): Promise<void> {
    if (!this.config.alertWebhookUrl) return;

    try {
      const payload = {
        content: `**Nirvana Watchdog Alert** [${os.hostname()}]\n` + alerts.join('\n'),
      };
      await fetch(this.config.alertWebhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      this.log.info('Successfully dispatched webhook alert');
    } catch (e) {
      this.log.error('Failed to dispatch webhook alert', e);
    }
  }
}
