/**
 * ProxyAcquisitionService — Multi-Source IP Acquisition Engine
 * 
 * Aggregates proxies from multiple commercial and free sources into
 * the ProxyPoolService for maximum IP coverage and registration throughput.
 * 
 * Sources:
 * 1. Commercial Residential Proxies (IPRoyal, ProxyCheap, WebShare, BrightData)
 * 2. Cloudflare WARP rotation (zero-cost, high-reputation)
 * 3. Free proxy scrapers (GitHub aggregators)
 * 4. Manual import (file-based)
 */

import { createLogger } from '../utils/Logger';
import { ProxyPoolService, type ProxyProtocol } from './ProxyPoolService';

const log = createLogger('ProxyAcquisition');

// ─── Provider configurations ───

export interface CommercialProxyProvider {
  name: string;
  type: 'residential' | 'datacenter' | 'isp' | 'mobile';
  /** API endpoint to fetch proxy list or generate session */
  apiUrl: string;
  /** API key or auth token */
  apiKey: string;
  /** Proxy format: 'gateway' (single rotating endpoint) or 'list' (fetch a list of IPs) */
  mode: 'gateway' | 'list';
  /** For gateway mode: the rotating proxy endpoint */
  gatewayHost?: string;
  gatewayPort?: number;
  /** For gateway mode: username template (e.g. 'user-{session}') */
  usernameTemplate?: string;
  password?: string;
  /** Country targeting */
  country?: string;
  /** Max sessions to generate (for gateway mode) */
  maxSessions?: number;
  enabled: boolean;
}

export interface WarpConfig {
  /** Docker container base name */
  containerPrefix: string;
  /** Number of WARP containers in the matrix */
  nodeCount: number;
  /** Base SOCKS5 port (e.g. 9001, nodes use 9001..9010) */
  basePort: number;
  /** Host where WARP containers run */
  host: string;
  /** Auto-rotate: disconnect/reconnect after each use */
  autoRotate: boolean;
  enabled: boolean;
}

export interface FreeScraperConfig {
  /** URLs to fetch proxy lists from */
  sources: string[];
  /** Interval between scrapes (ms) */
  scrapeIntervalMs: number;
  enabled: boolean;
}

export interface AcquisitionConfig {
  commercial: CommercialProxyProvider[];
  warp: WarpConfig;
  freeScraper: FreeScraperConfig;
}

// ─── Default Configs ───

const DEFAULT_COMMERCIAL_PROVIDERS: CommercialProxyProvider[] = [
  {
    name: 'IPRoyal',
    type: 'residential',
    apiUrl: 'https://dashboard.iproyal.com/api/residential',
    apiKey: '',
    mode: 'gateway',
    gatewayHost: 'geo.iproyal.com',
    gatewayPort: 12321,
    usernameTemplate: '{apiKey}_country-us_session-{session}_lifetime-10m',
    password: '',
    country: 'us',
    maxSessions: 50,
    enabled: false,
  },
  {
    name: 'ProxyCheap',
    type: 'residential',
    apiUrl: 'https://app.proxy-cheap.com/api',
    apiKey: '',
    mode: 'gateway',
    gatewayHost: 'rp.proxyscrape.com',
    gatewayPort: 6060,
    usernameTemplate: '{apiKey}',
    password: '',
    country: 'us',
    maxSessions: 50,
    enabled: false,
  },
  {
    name: 'WebShare',
    type: 'datacenter',
    apiUrl: 'https://proxy.webshare.io/api/v2/proxy/list',
    apiKey: '',
    mode: 'list',
    maxSessions: 100,
    enabled: false,
  },
  {
    name: 'BrightData',
    type: 'residential',
    apiUrl: 'https://brightdata.com/api',
    apiKey: '',
    mode: 'gateway',
    gatewayHost: 'brd.superproxy.io',
    gatewayPort: 22225,
    usernameTemplate: 'brd-customer-{apiKey}-zone-residential-country-us-session-{session}',
    password: '',
    country: 'us',
    maxSessions: 50,
    enabled: false,
  },
];

const DEFAULT_WARP_CONFIG: WarpConfig = {
  containerPrefix: 'warp-node',
  nodeCount: 10,
  basePort: 9001,
  host: '127.0.0.1',
  autoRotate: true,
  enabled: false,
};

const DEFAULT_FREE_SCRAPER_CONFIG: FreeScraperConfig = {
  sources: [
    'https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/http.txt',
    'https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/socks5.txt',
    'https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/http.txt',
    'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt',
    'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt',
    'https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt',
    'https://raw.githubusercontent.com/roosterkid/openproxylist/main/HTTPS_RAW.txt',
    'https://raw.githubusercontent.com/mmpx12/proxy-list/master/http.txt',
    'https://raw.githubusercontent.com/mmpx12/proxy-list/master/socks5.txt',
  ],
  scrapeIntervalMs: 600000, // 10 minutes
  enabled: true,
};

// ─── Service ───

export class ProxyAcquisitionService {
  private pool: ProxyPoolService;
  private config: AcquisitionConfig;
  private scrapeTimer?: NodeJS.Timeout;

  constructor(pool: ProxyPoolService, config?: Partial<AcquisitionConfig>) {
    this.pool = pool;
    this.config = {
      commercial: config?.commercial || DEFAULT_COMMERCIAL_PROVIDERS,
      warp: config?.warp || DEFAULT_WARP_CONFIG,
      freeScraper: config?.freeScraper || DEFAULT_FREE_SCRAPER_CONFIG,
    };
  }

  // ─── Lifecycle ───

  async start(): Promise<void> {
    log.info('=== ProxyAcquisitionService starting ===');

    // 1. Load commercial gateway sessions
    for (const provider of this.config.commercial.filter(p => p.enabled)) {
      await this.loadCommercialProvider(provider);
    }

    // 2. Load WARP matrix
    if (this.config.warp.enabled) {
      this.loadWarpMatrix();
    }

    // 3. Scrape free proxies (initial + periodic)
    if (this.config.freeScraper.enabled) {
      await this.scrapeFreeProxies();
      this.scrapeTimer = setInterval(() => {
        this.scrapeFreeProxies().catch(err => log.error('Free scrape failed:', err));
      }, this.config.freeScraper.scrapeIntervalMs);
    }

    log.info(`Acquisition complete. Pool now has ${this.pool.getStats().total} proxies.`);
  }

  stop(): void {
    if (this.scrapeTimer) {
      clearInterval(this.scrapeTimer);
      this.scrapeTimer = undefined;
    }
    log.info('ProxyAcquisitionService stopped');
  }

  // ─── Commercial Providers ───

  private async loadCommercialProvider(provider: CommercialProxyProvider): Promise<void> {
    log.info(`Loading commercial provider: ${provider.name} (${provider.mode})`);

    if (provider.mode === 'gateway') {
      // Gateway mode: generate N sticky sessions pointing to the same rotating endpoint
      const sessions = provider.maxSessions || 20;
      for (let i = 0; i < sessions; i++) {
        const sessionId = `s${Date.now().toString(36)}${i}`;
        const username = (provider.usernameTemplate || '{apiKey}')
          .replace('{apiKey}', provider.apiKey)
          .replace('{session}', sessionId);

        this.pool.addProxy({
          protocol: 'http' as ProxyProtocol,
          host: provider.gatewayHost || '',
          port: provider.gatewayPort || 8080,
          username,
          password: provider.password || provider.apiKey,
          country: provider.country,
          provider: provider.name,
          enabled: true,
          activeConnections: 0,
          lastUsedAt: 0,
        });
      }
      log.info(`  → Added ${sessions} gateway sessions for ${provider.name}`);

    } else if (provider.mode === 'list') {
      // List mode: fetch proxy list from API
      try {
        const headers: Record<string, string> = {
          'Authorization': `Token ${provider.apiKey}`,
          'User-Agent': 'Nirvana/1.0',
        };

        const res = await fetch(provider.apiUrl, { headers });
        if (!res.ok) {
          log.warn(`  → Failed to fetch from ${provider.name}: ${res.status}`);
          return;
        }

        const data = await res.json() as any;
        const results = data.results || data.proxies || data || [];
        let count = 0;

        for (const item of results) {
          const host = item.proxy_address || item.ip || item.host;
          const port = item.port || item.proxy_port;
          if (host && port) {
            this.pool.addProxy({
              protocol: (item.protocol || 'http') as ProxyProtocol,
              host,
              port: parseInt(String(port), 10),
              username: item.username,
              password: item.password,
              country: item.country_code || provider.country,
              provider: provider.name,
              enabled: true,
              activeConnections: 0,
              lastUsedAt: 0,
            });
            count++;
          }
        }
        log.info(`  → Imported ${count} proxies from ${provider.name} API`);
      } catch (err) {
        log.warn(`  → Error fetching ${provider.name}: ${err}`);
      }
    }
  }

  // ─── WARP Matrix ───

  private loadWarpMatrix(): void {
    const cfg = this.config.warp;
    log.info(`Loading WARP matrix: ${cfg.nodeCount} nodes from port ${cfg.basePort}`);

    for (let i = 0; i < cfg.nodeCount; i++) {
      const port = cfg.basePort + i;
      this.pool.addProxy({
        protocol: 'socks5' as ProxyProtocol,
        host: cfg.host,
        port,
        provider: 'CloudflareWARP',
        country: 'auto',
        enabled: true,
        activeConnections: 0,
        lastUsedAt: 0,
      });
    }

    log.info(`  → Added ${cfg.nodeCount} WARP SOCKS5 proxies`);
  }

  // ─── Free Proxy Scrapers ───

  private async scrapeFreeProxies(): Promise<void> {
    const sources = this.config.freeScraper.sources;
    log.info(`Scraping ${sources.length} free proxy sources...`);

    let totalImported = 0;

    const results = await Promise.allSettled(
      sources.map(async (url) => {
        try {
          const res = await fetch(url, {
            headers: { 'User-Agent': 'NirvanaProxyScraper/1.0' },
            signal: AbortSignal.timeout(15000),
          });
          if (!res.ok) return '';
          return await res.text();
        } catch {
          return '';
        }
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        const { imported } = this.pool.importProxies(result.value);
        totalImported += imported;
      }
    }

    log.info(`Free scrape complete: ${totalImported} new proxies imported`);
  }

  // ─── Dynamic Provider Management ───

  /** Enable/disable a commercial provider at runtime */
  setProviderEnabled(name: string, enabled: boolean): void {
    const provider = this.config.commercial.find(p => p.name === name);
    if (provider) {
      provider.enabled = enabled;
      log.info(`Provider ${name} ${enabled ? 'enabled' : 'disabled'}`);
    }
  }

  /** Update API key for a commercial provider */
  setProviderApiKey(name: string, apiKey: string): void {
    const provider = this.config.commercial.find(p => p.name === name);
    if (provider) {
      provider.apiKey = apiKey;
      log.info(`Provider ${name} API key updated`);
    }
  }

  /** Get all configured providers and their status */
  getProviders(): Array<{ name: string; type: string; enabled: boolean; mode: string }> {
    return this.config.commercial.map(p => ({
      name: p.name,
      type: p.type,
      enabled: p.enabled,
      mode: p.mode,
    }));
  }

  /** Enable/disable WARP matrix */
  setWarpEnabled(enabled: boolean): void {
    this.config.warp.enabled = enabled;
    log.info(`WARP matrix ${enabled ? 'enabled' : 'disabled'}`);
  }

  /** Trigger a manual free proxy scrape */
  async triggerScrape(): Promise<number> {
    await this.scrapeFreeProxies();
    return this.pool.getStats().total;
  }
}
