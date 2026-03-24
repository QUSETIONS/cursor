import { BaseService } from './base/BaseService';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

export type BrowserType = 'local' | 'vb' | 'nstbrowser';

export interface BrowserConfig {
  type: BrowserType;
  cdpPort?: number;
  // Local Puppeteer options
  chromePath?: string;      // Manual Chrome path (auto-detect if empty)
  headless?: boolean;       // default: false
  proxyUrl?: string;        // e.g. http://user:pass@host:port
  // VirtualBrowser
  vbApiKey?: string;
  vbBaseURL?: string;
  vbChromeVersion?: number;
  vbGroupId?: string;
  vbExecutablePath?: string;
  vbDynamicEnv?: boolean;
  // Nstbrowser
  nstApiKey?: string;
  nstProfileId?: string;
  nstUseOnceBrowser?: boolean;
}

export interface BrowserEnv {
  id: string;
  type: BrowserType;
  wsEndpoint: string;
  profileId?: string;
  browserInstance?: any;  // Keep reference for local browsers to close later
}

/**
 * Browser environment management service.
 * 
 * Supports three modes:
 * - **local**: Launch Chrome/Chromium locally via puppeteer-core + stealth plugin
 * - **vb**: VirtualBrowser fingerprint browser API
 * - **nstbrowser**: Nstbrowser fingerprint browser API
 * 
 * The `local` mode auto-detects Chrome on Windows/macOS/Linux and provides
 * stealth anti-fingerprinting out of the box.
 */
export class BrowserService extends BaseService {
  private config: BrowserConfig | null = null;
  private activeEnvs = new Map<string, BrowserEnv>();

  constructor() {
    super('BrowserService');
  }

  protected async initialize(): Promise<void> {
    this.logger.info('BrowserService initialized');
  }

  protected async shutdown(): Promise<void> {
    for (const [id] of this.activeEnvs) {
      try {
        await this.destroyEnvironment(id);
      } catch { /* best effort */ }
    }
    this.logger.info('BrowserService shut down — all environments cleaned');
  }

  async healthCheck(): Promise<boolean> {
    if (!this.config) return false;

    try {
      if (this.config.type === 'local') {
        const chromePath = this.config.chromePath || this.findChromePath();
        return !!chromePath && fs.existsSync(chromePath);
      } else if (this.config.type === 'vb') {
        return await this.checkVBHealth();
      } else {
        return await this.checkNstHealth();
      }
    } catch {
      return false;
    }
  }

  setConfig(config: BrowserConfig): void {
    this.config = config;
    this.logger.info(`Browser type: ${config.type}${config.type === 'local' ? ` (headless: ${config.headless ?? false})` : ''}`);
  }

  /**
   * Create a new isolated browser environment.
   */
  async createEnvironment(overrideConfig?: Partial<BrowserConfig>): Promise<BrowserEnv> {
    if (!this.config) throw new Error('BrowserService 未配置');

    return this.withResilience(async () => {
      let env: BrowserEnv;
      
      const mergedConfig: BrowserConfig = { ...this.config!, ...overrideConfig };

      if (mergedConfig.type === 'local') {
        env = await this.createLocalBrowser(mergedConfig);
      } else if (mergedConfig.type === 'vb') {
        env = mergedConfig.vbDynamicEnv
          ? await this.createVBDynamicEnv()
          : await this.connectVBStatic();
      } else {
        env = mergedConfig.nstUseOnceBrowser
          ? await this.createNstOnceBrowser()
          : await this.connectNstProfile();
      }

      this.activeEnvs.set(env.id, env);
      this.logger.info(`✅ 浏览器环境已创建: ${env.id}`);
      return env;
    }, 'createEnvironment');
  }

  /**
   * Destroy a browser environment and clean up.
   */
  async destroyEnvironment(id: string): Promise<void> {
    const env = this.activeEnvs.get(id);
    if (!env) return;

    try {
      if (env.type === 'local' && env.browserInstance) {
        // Close the locally launched browser
        try {
          await env.browserInstance.close();
        } catch { /* ignore */ }
      } else if (this.config?.type === 'vb' && this.config.vbDynamicEnv) {
        await this.destroyVBEnv(id);
      } else if (this.config?.type === 'nstbrowser' && this.config.nstUseOnceBrowser) {
        await this.destroyNstEnv(id);
      }
    } catch (error) {
      this.logger.warn(`环境清理失败 [${id}]: ${error}`);
    }

    this.activeEnvs.delete(id);
    this.logger.info(`🗑️ 浏览器环境已销毁: ${id}`);
  }

  /**
   * Get the CDP WebSocket endpoint for connecting puppeteer-core.
   */
  getWSEndpoint(envId: string): string | null {
    return this.activeEnvs.get(envId)?.wsEndpoint || null;
  }

  // ─── Local Browser Implementation ───

  private async createLocalBrowser(config: BrowserConfig): Promise<BrowserEnv> {
    const puppeteer = require('puppeteer-extra');
    const StealthPlugin = require('puppeteer-extra-plugin-stealth');
    puppeteer.use(StealthPlugin());

    const chromePath = config.chromePath || this.findChromePath();
    if (!chromePath) {
      throw new Error(
        '未找到本地 Chrome 浏览器。请手动安装 Chrome 或在设置中指定 Chrome 路径。\n' +
        '常见路径: C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
      );
    }

    this.logger.info(`🌐 使用本地 Chrome: ${chromePath}`);

    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1280,800',
    ];

    // Add proxy if configured
    if (config.proxyUrl) {
      let proxyArg = config.proxyUrl;
      try {
        const url = new URL(proxyArg);
        proxyArg = `${url.protocol}//${url.hostname}:${url.port}`;
      } catch {
        // Bare host:port — check if it's a known SOCKS5 proxy (WARP nodes on 9001-9010)
        if (/^127\.0\.0\.1:90\d{2}$/.test(proxyArg) || /socks/i.test(proxyArg)) {
          proxyArg = `socks5://${proxyArg}`;
        }
      }
      args.push(`--proxy-server=${proxyArg}`);
      // Force DNS through SOCKS proxy (critical for WARP to route correctly)
      args.push('--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1');
      this.logger.info(`🔗 代理: ${proxyArg}`);
    }

    const browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: config.headless ?? false,
      args,
      defaultViewport: null,
      ignoreDefaultArgs: ['--enable-automation'],
    });

    const wsEndpoint = browser.wsEndpoint();
    const id = `local-${Date.now()}`;

    return { id, type: 'local', wsEndpoint, browserInstance: browser };
  }

  /**
   * Auto-detect Chrome/Chromium executable path across platforms.
   */
  private findChromePath(): string | null {
    const platform = process.platform;

    if (platform === 'win32') {
      const candidates = [
        path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env['LOCALAPPDATA'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        // Edge as fallback (Chromium-based)
        path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      ];
      for (const p of candidates) {
        if (p && fs.existsSync(p)) return p;
      }
      // Try `where` command
      try {
        const result = execSync('where chrome', { encoding: 'utf-8', timeout: 5000 }).trim();
        if (result && fs.existsSync(result.split('\n')[0].trim())) return result.split('\n')[0].trim();
      } catch { /* not found */ }
    } else if (platform === 'darwin') {
      const candidates = [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
      ];
      for (const p of candidates) {
        if (fs.existsSync(p)) return p;
      }
    } else {
      // Linux
      const candidates = ['google-chrome', 'google-chrome-stable', 'chromium-browser', 'chromium'];
      for (const name of candidates) {
        try {
          const result = execSync(`which ${name}`, { encoding: 'utf-8', timeout: 5000 }).trim();
          if (result) return result;
        } catch { /* not found */ }
      }
    }

    return null;
  }

  // ─── VirtualBrowser Implementation ───

  private async createVBDynamicEnv(): Promise<BrowserEnv> {
    const apiBase = this.config!.vbBaseURL || 'http://localhost:9000';
    const apiKey = this.config!.vbApiKey || '';

    const response = await this.apiRequest('POST', `${apiBase}/api/v1/profile/create`, {
      groupId: this.config!.vbGroupId || '0',
      chromeVersion: this.config!.vbChromeVersion || 132,
    }, { 'X-API-Key': apiKey });

    const profileId = response.data?.id || response.id;
    if (!profileId) throw new Error('VB 环境创建失败: 无 profileId');

    const startResponse = await this.apiRequest(
      'POST',
      `${apiBase}/api/v1/profile/start/${profileId}`,
      {},
      { 'X-API-Key': apiKey }
    );

    const wsEndpoint = startResponse.data?.wsEndpoint || startResponse.wsEndpoint;
    if (!wsEndpoint) throw new Error('VB 环境启动失败: 无 wsEndpoint');

    return { id: profileId, type: 'vb', wsEndpoint, profileId };
  }

  private async connectVBStatic(): Promise<BrowserEnv> {
    const port = this.config!.cdpPort || 9222;
    const wsEndpoint = await this.getCDPEndpoint(port);
    return { id: `vb-static-${port}`, type: 'vb', wsEndpoint };
  }

  private async destroyVBEnv(profileId: string): Promise<void> {
    const apiBase = this.config!.vbBaseURL || 'http://localhost:9000';
    const apiKey = this.config!.vbApiKey || '';

    await this.apiRequest('POST', `${apiBase}/api/v1/profile/stop/${profileId}`, {}, {
      'X-API-Key': apiKey,
    }).catch(() => {});

    await this.apiRequest('DELETE', `${apiBase}/api/v1/profile/delete/${profileId}`, {}, {
      'X-API-Key': apiKey,
    }).catch(() => {});
  }

  // ─── Nstbrowser Implementation ───

  private async createNstOnceBrowser(): Promise<BrowserEnv> {
    const apiKey = this.config!.nstApiKey || '';
    const config = {
      once: true,
      headless: false,
      autoClose: false,
      fingerprint: { name: 'random', platform: 'windows', kernel: 'chromium' },
    };

    const params = new URLSearchParams({ 'x-api-key': apiKey, config: JSON.stringify(config) });
    const wsEndpoint = `ws://localhost:8848/devtool/launch?${params}`;
    const id = `nst-once-${Date.now()}`;

    return { id, type: 'nstbrowser', wsEndpoint };
  }

  private async connectNstProfile(): Promise<BrowserEnv> {
    const apiKey = this.config!.nstApiKey || '';
    const profileId = this.config!.nstProfileId || '';

    const profiles = profileId.split('\n').filter((p) => p.trim());
    if (profiles.length === 0) throw new Error('无可用 Nstbrowser Profile');

    const selected = profiles[Math.floor(Math.random() * profiles.length)].trim();

    const config = { headless: false, autoClose: false };
    const params = new URLSearchParams({
      'x-api-key': apiKey,
      profileId: selected,
      config: JSON.stringify(config),
    });
    const wsEndpoint = `ws://localhost:8848/devtool/launch?${params}`;

    return { id: selected, type: 'nstbrowser', wsEndpoint, profileId: selected };
  }

  private async destroyNstEnv(_id: string): Promise<void> {
    // Once browsers auto-close; profile-based don't need destruction
  }

  // ─── Health Checks ───

  private async checkVBHealth(): Promise<boolean> {
    if (this.config?.vbDynamicEnv) {
      const apiBase = this.config.vbBaseURL || 'http://localhost:9000';
      try {
        await this.apiRequest('GET', `${apiBase}/api/v1/profile/list`, null, {
          'X-API-Key': this.config.vbApiKey || '',
        });
        return true;
      } catch {
        return false;
      }
    }
    try {
      await this.getCDPEndpoint(this.config!.cdpPort || 9222);
      return true;
    } catch {
      return false;
    }
  }

  private async checkNstHealth(): Promise<boolean> {
    try {
      const resp = await this.httpGet('http://localhost:8848/health');
      return resp.includes('ok') || resp.includes('200');
    } catch {
      return false;
    }
  }

  // ─── Helpers ───

  private async getCDPEndpoint(port: number): Promise<string> {
    const json = await this.httpGet(`http://127.0.0.1:${port}/json/version`);
    const parsed = JSON.parse(json);
    if (!parsed.webSocketDebuggerUrl) throw new Error(`CDP 端口 ${port} 无 WebSocket 端点`);
    return parsed.webSocketDebuggerUrl;
  }

  private httpGet(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      http.get(url, { timeout: 5000 }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve(data));
      }).on('error', reject);
    });
  }

  private async apiRequest(
    method: string,
    url: string,
    body: unknown,
    headers?: Record<string, string>
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const bodyStr = body ? JSON.stringify(body) : '';
      const reqHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        ...headers,
      };
      if (bodyStr) reqHeaders['Content-Length'] = Buffer.byteLength(bodyStr).toString();

      const client = urlObj.protocol === 'https:' ? https : http;
      const req = client.request(
        {
          hostname: urlObj.hostname,
          port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
          path: urlObj.pathname + urlObj.search,
          method,
          headers: reqHeaders,
          timeout: 10000,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch {
              resolve(data);
            }
          });
        }
      );
      req.on('error', reject);
      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  }
}
