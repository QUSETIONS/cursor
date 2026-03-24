import { BaseService } from './base/BaseService';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import https from 'node:https';
import http from 'node:http';

const execAsync = promisify(exec);

export type IPStrategy = 'adb' | 'clash' | 'zte' | 'system' | 'proxy';

export interface IPSwitchConfig {
  strategy: IPStrategy;
  // ADB options
  adbPath?: string;
  airplaneDuration?: number;
  networkRecoverWait?: number;
  // Clash options
  clashApiUrl?: string;
  clashApiSecret?: string;
  clashProxyGroup?: string;
  clashExcludeNodes?: string;
  // ZTE options
  zteHost?: string;
  ztePassword?: string;
  // Smart switching
  switchEveryN?: number;
  switchOnCloudflareN?: number;
  switchOnFailN?: number;
}

interface SwitchResult {
  success: boolean;
  previousIP?: string;
  newIP?: string;
  strategy: string;
  error?: string;
}

/**
 * IP switching service with multiple strategy support.
 * 
 * Features:
 * - ADB airplane mode toggle (mobile hotspot)
 * - Clash proxy node rotation
 * - ZTE router reboot
 * - IP change verification after switch
 * - Smart switch triggers (every-N, on-cloudflare, on-fail)
 * 
 * Fixes original Issue #12: No health verification after IP switch.
 */
export class IPSwitchService extends BaseService {
  private config: IPSwitchConfig | null = null;
  private switchCount = 0;
  private failCount = 0;
  private cloudflareCount = 0;

  constructor() {
    super('IPSwitchService');
  }

  protected async initialize(): Promise<void> {
    this.logger.info('IPSwitchService initialized');
  }

  protected async shutdown(): Promise<void> {
    this.logger.info('IPSwitchService shut down');
  }

  async healthCheck(): Promise<boolean> {
    try {
      const ip = await this.getCurrentIP();
      return !!ip;
    } catch {
      return false;
    }
  }

  setConfig(config: IPSwitchConfig): void {
    this.config = config;
    this.logger.info(`IP switch strategy: ${config.strategy}`);
  }

  /**
   * Get current public IP address.
   */
  async getCurrentIP(): Promise<string> {
    const services = [
      'https://api.ipify.org',
      'https://icanhazip.com',
      'https://ifconfig.me/ip',
    ];

    for (const url of services) {
      try {
        const ip = await this.httpGet(url);
        const trimmed = ip.trim();
        if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(trimmed)) {
          return trimmed;
        }
      } catch { /* try next */ }
    }

    throw new Error('无法获取当前 IP 地址');
  }

  /**
   * Check if IP switch should be triggered based on smart rules.
   */
  shouldSwitch(event: 'success' | 'fail' | 'cloudflare'): boolean {
    if (!this.config) return false;

    if (event === 'success') {
      this.switchCount++;
      this.failCount = 0;
      this.cloudflareCount = 0;
      return !!(this.config.switchEveryN && this.switchCount % this.config.switchEveryN === 0);
    }

    if (event === 'fail') {
      this.failCount++;
      return !!(this.config.switchOnFailN && this.failCount >= this.config.switchOnFailN);
    }

    if (event === 'cloudflare') {
      this.cloudflareCount++;
      return !!(
        this.config.switchOnCloudflareN &&
        this.cloudflareCount >= this.config.switchOnCloudflareN
      );
    }

    return false;
  }

  /**
   * Switch IP using configured strategy, then VERIFY the IP actually changed.
   */
  async switchIP(): Promise<SwitchResult> {
    if (!this.config) {
      return { success: false, strategy: 'none', error: '未配置 IP 切换策略' };
    }

    const previousIP = await this.getCurrentIP().catch(() => 'unknown');
    this.logger.info(`🔄 开始切换 IP (当前: ${previousIP}, 策略: ${this.config.strategy})`);

    try {
      switch (this.config.strategy) {
        case 'adb':
          await this.switchViaAdb();
          break;
        case 'clash':
          await this.switchViaClash();
          break;
        case 'zte':
          await this.switchViaZte();
          break;
        case 'system':
          this.logger.info('系统原生代理 — 无需主动切换');
          return { success: true, previousIP, strategy: 'system' };
        default:
          throw new Error(`未知策略: ${this.config.strategy}`);
      }

      // ★ CRITICAL: Verify IP actually changed
      const newIP = await this.verifyIPChanged(previousIP);
      if (newIP) {
        this.failCount = 0;
        this.cloudflareCount = 0;
        this.logger.info(`✅ IP 切换成功: ${previousIP} → ${newIP}`);
        return { success: true, previousIP, newIP, strategy: this.config.strategy };
      } else {
        this.logger.warn('⚠️ IP 切换后地址未变更');
        return { success: false, previousIP, strategy: this.config.strategy, error: 'IP 未变更' };
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`❌ IP 切换失败: ${msg}`);
      return { success: false, previousIP, strategy: this.config.strategy, error: msg };
    }
  }

  /**
   * Verify that IP has changed (poll with retries).
   */
  private async verifyIPChanged(previousIP: string): Promise<string | null> {
    for (let i = 0; i < 10; i++) {
      await this.sleep(3000);
      try {
        const currentIP = await this.getCurrentIP();
        if (currentIP !== previousIP) return currentIP;
      } catch { /* retry */ }
    }
    return null;
  }

  // ─── Strategy Implementations ───

  private async switchViaAdb(): Promise<void> {
    const adbPath = this.config!.adbPath || 'adb';
    const airplaneDuration = this.config!.airplaneDuration || 5;
    const networkWait = this.config!.networkRecoverWait || 5;

    // Enable airplane mode
    await execAsync(`"${adbPath}" shell settings put global airplane_mode_on 1`);
    await execAsync(
      `"${adbPath}" shell am broadcast -a android.intent.action.AIRPLANE_MODE --ez state true`
    );
    this.logger.info(`✈️ 飞行模式已开启, 等待 ${airplaneDuration}s`);
    await this.sleep(airplaneDuration * 1000);

    // Disable airplane mode
    await execAsync(`"${adbPath}" shell settings put global airplane_mode_on 0`);
    await execAsync(
      `"${adbPath}" shell am broadcast -a android.intent.action.AIRPLANE_MODE --ez state false`
    );
    this.logger.info(`📶 飞行模式已关闭, 等待网络恢复 ${networkWait}s`);
    await this.sleep(networkWait * 1000);
  }

  private async switchViaClash(): Promise<void> {
    const apiUrl = this.config!.clashApiUrl || 'http://127.0.0.1:9097';
    const secret = this.config!.clashApiSecret || '';
    const group = this.config!.clashProxyGroup || '';
    const exclude = this.config!.clashExcludeNodes || '';

    // Get proxy group info
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (secret) headers['Authorization'] = `Bearer ${secret}`;

    const groupInfo = JSON.parse(
      await this.httpGet(`${apiUrl}/proxies/${encodeURIComponent(group)}`, headers)
    );
    const allNodes: string[] = groupInfo.all || [];
    const currentNode = groupInfo.now || '';

    // Filter excluded nodes
    const excludeList = exclude.split(',').map((s: string) => s.trim().toLowerCase());
    const available = allNodes.filter(
      (n: string) =>
        n !== currentNode &&
        !excludeList.some((ex: string) => n.toLowerCase().includes(ex))
    );

    if (available.length === 0) throw new Error('无可用代理节点');

    // Pick random node
    const nextNode = available[Math.floor(Math.random() * available.length)];
    this.logger.info(`🌐 Clash: ${currentNode} → ${nextNode}`);

    // Switch node
    await this.httpPut(
      `${apiUrl}/proxies/${encodeURIComponent(group)}`,
      JSON.stringify({ name: nextNode }),
      headers
    );

    await this.sleep(2000);
  }

  private async switchViaZte(): Promise<void> {
    const host = this.config!.zteHost || '192.168.0.1';
    const password = this.config!.ztePassword || 'admin';

    this.logger.info(`📡 ZTE 路由器重拨: ${host}`);

    // ZTE routers typically have a web API for network reset
    // This is a simplified version — real implementation depends on model
    const loginUrl = `http://${host}/goform/goform_set_cmd_process`;
    const loginData = `isTest=false&goformId=LOGIN&password=${Buffer.from(password).toString('base64')}`;

    await this.httpPost(loginUrl, loginData, {
      'Content-Type': 'application/x-www-form-urlencoded',
    });

    // Trigger network reconnect
    const reconnectData = 'isTest=false&goformId=CONNECT_NETWORK';
    await this.httpPost(loginUrl, reconnectData, {
      'Content-Type': 'application/x-www-form-urlencoded',
    });

    await this.sleep(10000); // Wait for reconnection
  }

  // ─── HTTP Helpers ───

  private httpGet(url: string, headers?: Record<string, string>): Promise<string> {
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;
      const req = client.get(url, { headers, timeout: 10000 }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    });
  }

  private httpPost(url: string, body: string, headers?: Record<string, string>): Promise<string> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const client = urlObj.protocol === 'https:' ? https : http;
      const req = client.request(
        { hostname: urlObj.hostname, port: urlObj.port, path: urlObj.pathname, method: 'POST', headers, timeout: 10000 },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve(data));
        }
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  private httpPut(url: string, body: string, headers?: Record<string, string>): Promise<string> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const client = urlObj.protocol === 'https:' ? https : http;
      const req = client.request(
        { hostname: urlObj.hostname, port: urlObj.port, path: urlObj.pathname, method: 'PUT', headers, timeout: 10000 },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve(data));
        }
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
