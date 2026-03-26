/**
 * ProxyPoolService v3 — Full-featured proxy pool with:
 * 1. Pluggable proxy source architecture (ProxySource interface)
 * 2. Auto-fetch from proxifly CDN
 * 3. Top-3 FastLane best proxy selection
 * 4. Score-based auto-purge
 * 5. Health checks routed THROUGH the proxy (HTTP CONNECT)
 * 6. Quality scoring (latency + anonymity + Cloudflare reachability)
 * 7. FOFA auto-discovery support
 */

import { createLogger } from '../utils/Logger';
import { StorageService } from './StorageService';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import fs from 'node:fs';

export type ProxyProtocol = 'http' | 'https' | 'socks5';

export interface ProxyEntry {
  id: string;
  protocol: ProxyProtocol;
  host: string;
  port: number;
  username?: string;
  password?: string;
  country?: string;
  provider?: string;
  latencyMs?: number;
  failCount: number;
  successCount: number;
  lastCheckedAt?: string;
  isHealthy: boolean;
  enabled: boolean;
  qualityScore: number;
  isAnonymous?: boolean;
  externalIP?: string;
  source?: string;
  
  // Concurrency and protection
  activeConnections: number;
  lastUsedAt: number;
  
  // IPv6 support — WARP proxies get unique Cloudflare IPv6 addresses
  ipv6Capable?: boolean;
  ipv6Address?: string;
}

// ─── Pluggable Proxy Source Interface ───

export interface ProxySource {
  name: string;
  fetchIntervalMs: number;
  /** Returns proxy URIs like "socks5://1.2.3.4:1080" or "http://1.2.3.4:8080" */
  fetch(): Promise<string[]>;
}

// ─── Built-in Sources ───

/** Proxifly CDN + multi-source — free, auto-updated lists from multiple GitHub repos */
export class ProxiflyCDNSource implements ProxySource {
  name = 'proxifly-cdn';
  fetchIntervalMs = 600_000; // 10 min

  private urls = [
    // ── proxifly (updated every 5 min) ──
    'https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/socks5/data.txt',
    'https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/http/data.txt',
    'https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/https/data.txt',
    // ── TheSpeedX (large, regularly updated) ──
    'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt',
    'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',
    'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks4.txt',
    // ── jetkai (hourly, tested) ──
    'https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies-socks5.txt',
    'https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies-http.txt',
    'https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies-https.txt',
    // ── Zaeem20 (every 10 min) ──
    'https://raw.githubusercontent.com/Zaeem20/FREE_PROXIES_LIST/master/socks5.txt',
    'https://raw.githubusercontent.com/Zaeem20/FREE_PROXIES_LIST/master/http.txt',
    'https://raw.githubusercontent.com/Zaeem20/FREE_PROXIES_LIST/master/https.txt',
    // ── hookzof (big, verified) ──
    'https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt',
    // ── monosans (auto-verified, clean) ──
    'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt',
    'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt',
    // ── vakhov (daily, multi-format) ──
    'https://raw.githubusercontent.com/vakhov/fresh-proxy-list/master/socks5.txt',
    'https://raw.githubusercontent.com/vakhov/fresh-proxy-list/master/http.txt',
    'https://raw.githubusercontent.com/vakhov/fresh-proxy-list/master/https.txt',
    // ── sunny9577 (verified) ──
    'https://raw.githubusercontent.com/sunny9577/proxy-scraper/master/generated/socks5_proxies.txt',
    'https://raw.githubusercontent.com/sunny9577/proxy-scraper/master/generated/http_proxies.txt',
    // ── roosterkid (auto-updated) ──
    'https://raw.githubusercontent.com/roosterkid/openproxylist/main/SOCKS5_RAW.txt',
    'https://raw.githubusercontent.com/roosterkid/openproxylist/main/HTTP_RAW.txt',
  ];

  async fetch(): Promise<string[]> {
    const results: string[] = [];
    const seen = new Set<string>();
    for (const url of this.urls) {
      try {
        const text = await fetchText(url, 15000);
        const lines = text.split('\n').map(l => l.trim()).filter(l => l && /\d+\.\d+\.\d+\.\d+:\d+/.test(l));
        for (const line of lines) {
          // Normalize to protocol://ip:port
          const normalized = line.includes('://') ? line : (
            url.includes('socks5') || url.includes('SOCKS5') ? `socks5://${line}` :
            url.includes('socks4') || url.includes('SOCKS4') ? `socks5://${line}` :
            url.includes('https') ? `https://${line}` : `http://${line}`
          );
          if (!seen.has(normalized)) { seen.add(normalized); results.push(normalized); }
        }
      } catch { /* skip failed source */ }
    }
    return results;
  }
}

/** Local file source — reads ip:port list from a text file */
export class LocalFileSource implements ProxySource {
  name: string;
  fetchIntervalMs = 0; // One-shot
  private filePath: string;
  private defaultProtocol: ProxyProtocol;

  constructor(filePath: string, protocol: ProxyProtocol = 'socks5') {
    this.name = `file:${filePath.split(/[/\\]/).pop()}`;
    this.filePath = filePath;
    this.defaultProtocol = protocol;
  }

  async fetch(): Promise<string[]> {
    const text = fs.readFileSync(this.filePath, 'utf-8');
    return text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => {
      if (l.includes('://')) return l;
      return `${this.defaultProtocol}://${l}`;
    });
  }
}

/** FOFA search engine source — requires API key */
export class FOFASource implements ProxySource {
  name = 'fofa';
  fetchIntervalMs = 3600_000; // 1 hour

  constructor(
    private email: string,
    private apiKey: string,
    private query: string = 'protocol=="socks5" && "Version:5 Method:No Authentication(0x00)"',
    private maxResults: number = 500,
  ) {}

  async fetch(): Promise<string[]> {
    try {
      const q = Buffer.from(this.query).toString('base64');
      const url = `https://fofa.info/api/v1/search/all?email=${this.email}&key=${this.apiKey}&qbase64=${q}&size=${this.maxResults}&fields=host,port,protocol`;
      const text = await fetchText(url, 30000);
      const data = JSON.parse(text);
      if (!data.results || !Array.isArray(data.results)) return [];
      return data.results.map((r: string[]) => {
        const [host, port, proto] = r;
        return `${proto || 'socks5'}://${host}:${port}`;
      });
    } catch { return []; }
  }
}

/** Quake search engine source */
export class QuakeSource implements ProxySource {
  name = 'quake';
  fetchIntervalMs = 3600_000;

  constructor(
    private apiKey: string,
    private query: string = 'service:"socks5" and response:"Accepted Auth Method: 0x0"',
    private maxResults: number = 500,
  ) {}

  async fetch(): Promise<string[]> {
    try {
      const url = 'https://quake.360.net/api/v3/search/quake_service';
      const text = await fetchJSON(url, {
        method: 'POST',
        headers: { 'X-QuakeToken': this.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: this.query, size: this.maxResults, start: 0 }),
      }, 30000);
      const data = JSON.parse(text);
      if (!data.data || !Array.isArray(data.data)) return [];
      return data.data.map((item: any) => `socks5://${item.ip}:${item.port}`);
    } catch { return []; }
  }
}

/** Public ProxyPool instance discovery via known endpoints */
export class PublicPoolSource implements ProxySource {
  name = 'public-pools';
  fetchIntervalMs = 1800_000; // 30 min

  private urls: string[];

  constructor(urls?: string[]) {
    this.urls = urls || [
      'https://proxypool.scrape.center/all',
    ];
  }

  async fetch(): Promise<string[]> {
    const results: string[] = [];
    for (const url of this.urls) {
      try {
        const text = await fetchText(url, 10000);
        // Format: "ip:port ip:port ..." or newline-separated
        const proxies = text.split(/[\s,]+/).filter(p => /^\d+\.\d+\.\d+\.\d+:\d+$/.test(p));
        results.push(...proxies.map(p => `http://${p}`));
      } catch { /* skip */ }
    }
    return results;
  }
}

// ─── Pool Config ───

export interface ProxyPoolConfig {
  strategy: 'round-robin' | 'random' | 'least-used' | 'fastest' | 'quality' | 'fastlane';
  healthCheckIntervalMs: number;
  maxFailBeforeDisable: number;
  healthCheckUrl: string;
  healthCheckTimeoutMs: number;
  cloudflareTestUrl?: string;
  /** Auto-purge proxies with score <= 0 */
  autoPurge: boolean;
  /** How many top proxies to keep in the FastLane */
  fastLaneSize: number;
  /** Source fetch interval override (ms) */
  sourceFetchIntervalMs: number;
}

const DEFAULT_CONFIG: ProxyPoolConfig = {
  strategy: 'quality',
  healthCheckIntervalMs: 300_000,
  maxFailBeforeDisable: 3,
  healthCheckUrl: 'https://httpbin.org/get',
  healthCheckTimeoutMs: 15000,
  cloudflareTestUrl: 'https://authenticator.cursor.sh',
  autoPurge: true,
  fastLaneSize: 3,
  sourceFetchIntervalMs: 600_000,
};

// ─── Main Service ───

export class ProxyPoolService {
  private proxies: Map<string, ProxyEntry> = new Map();
  private config: ProxyPoolConfig;
  private roundRobinIndex = 0;
  private healthCheckTimer?: NodeJS.Timeout;
  private sourceTimers: Map<string, NodeJS.Timeout> = new Map();
  private sources: ProxySource[] = [];
  private fastLane: ProxyEntry[] = [];
  private log = createLogger('ProxyPool');
  
  // Storage logic
  private activeLeases: Map<string, ProxyEntry> = new Map();
  private historicalScores: Record<string, number> = {};

  constructor(config?: Partial<ProxyPoolConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.historicalScores = StorageService.loadProxyScores();
  }

  // ─── Source Management ───

  addSource(source: ProxySource): void {
    this.sources.push(source);
    this.log.info(`Added proxy source: ${source.name} (interval: ${source.fetchIntervalMs}ms)`);
  }

  removeSource(name: string): void {
    this.sources = this.sources.filter(s => s.name !== name);
    const timer = this.sourceTimers.get(name);
    if (timer) { clearInterval(timer); this.sourceTimers.delete(name); }
  }

  listSources(): { name: string; intervalMs: number }[] {
    return this.sources.map(s => ({ name: s.name, intervalMs: s.fetchIntervalMs }));
  }

  /** Fetch from all sources once */
  async fetchAllSources(): Promise<{ source: string; added: number; skipped: number }[]> {
    const results: { source: string; added: number; skipped: number }[] = [];
    for (const source of this.sources) {
      try {
        const uris = await source.fetch();
        const { imported, skipped } = this.importProxyURIs(uris, source.name);
        results.push({ source: source.name, added: imported, skipped });
        this.log.info(`[${source.name}] Fetched ${uris.length}, added ${imported}, skipped ${skipped}`);
      } catch (e: any) {
        this.log.error(`[${source.name}] Fetch failed: ${e.message}`);
        results.push({ source: source.name, added: 0, skipped: 0 });
      }
    }
    return results;
  }

  // ─── Lifecycle ───

  start(): void {
    // Health check timer
    this.healthCheckTimer = setInterval(() => this.healthCheckAll(), this.config.healthCheckIntervalMs);

    // Source fetch timers
    for (const source of this.sources) {
      const interval = source.fetchIntervalMs || this.config.sourceFetchIntervalMs;
      if (interval > 0) {
        // Initial fetch
        this.fetchSource(source);
        // Periodic fetch
        const timer = setInterval(() => this.fetchSource(source), interval);
        this.sourceTimers.set(source.name, timer);
      } else {
        // One-shot source
        this.fetchSource(source);
      }
    }

    this.log.info(`Proxy pool started (${this.proxies.size} proxies, ${this.sources.length} sources, strategy: ${this.config.strategy})`);
  }

  stop(): void {
    if (this.healthCheckTimer) clearInterval(this.healthCheckTimer);
    for (const [, timer] of this.sourceTimers) clearInterval(timer);
    this.sourceTimers.clear();
    this.log.info('Proxy pool stopped');
  }

  private async fetchSource(source: ProxySource): Promise<void> {
    try {
      const uris = await source.fetch();
      const { imported } = this.importProxyURIs(uris, source.name);
      if (imported > 0) this.log.info(`[${source.name}] Added ${imported} new proxies`);
    } catch (e: any) {
      this.log.error(`[${source.name}] Fetch error: ${e.message}`);
    }
  }

  // ─── CRUD ───

  addProxy(entry: Omit<ProxyEntry, 'id' | 'failCount' | 'successCount' | 'isHealthy'>): ProxyEntry {
    const id = `proxy-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const proxy: ProxyEntry = {
      ...entry, id,
      failCount: 0, successCount: 0, isHealthy: true, 
      qualityScore: entry.qualityScore ?? 50,
      enabled: entry.enabled !== undefined ? entry.enabled : true,
    };
    this.proxies.set(id, proxy);
    return proxy;
  }

  removeProxy(id: string): boolean { return this.proxies.delete(id); }
  getProxy(id: string): ProxyEntry | undefined { return this.proxies.get(id); }
  listProxies(): ProxyEntry[] { return Array.from(this.proxies.values()); }

  importProxies(text: string): { imported: number; skipped: number } {
    const lines = text.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
    return this.importProxyURIs(lines.map(l => {
      const t = l.trim();
      return t.includes('://') ? t : `socks5://${t}`;
    }));
  }

  private importProxyURIs(uris: string[], sourceName?: string): { imported: number; skipped: number } {
    let imported = 0, skipped = 0;
    for (const uri of uris) {
      const parsed = this.parseURI(uri);
      if (!parsed) { skipped++; continue; }
      const exists = Array.from(this.proxies.values()).some(p => p.host === parsed.host && p.port === parsed.port);
      if (exists) { skipped++; continue; }
      
      const key = `${parsed.host}:${parsed.port}`;
      const savedScore = this.historicalScores[key];
      
      this.addProxy({ 
        ...parsed, 
        source: sourceName, 
        enabled: true, 
        activeConnections: 0, 
        lastUsedAt: 0,
        qualityScore: savedScore !== undefined ? savedScore : 50 
      });
      imported++;
    }
    return { imported, skipped };
  }

  exportProxies(): string {
    return Array.from(this.proxies.values()).map(p => {
      const auth = p.username ? `${p.username}:${p.password || ''}@` : '';
      return `${p.protocol}://${auth}${p.host}:${p.port}`;
    }).join('\n');
  }

  /** Import from a local file path */
  importFromFile(filePath: string, protocol: ProxyProtocol = 'socks5'): { imported: number; skipped: number } {
    const text = fs.readFileSync(filePath, 'utf-8');
    const uris = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l =>
      l.includes('://') ? l : `${protocol}://${l}`
    );
    return this.importProxyURIs(uris, `file:${filePath.split(/[/\\]/).pop()}`);
  }

  // ─── Selection ───

  getNext(): ProxyEntry | null {
    const available = Array.from(this.proxies.values()).filter(p => p.enabled && p.isHealthy);
    if (available.length === 0) return null;

    switch (this.config.strategy) {
      case 'round-robin': {
        this.roundRobinIndex = this.roundRobinIndex % available.length;
        return available[this.roundRobinIndex++];
      }
      case 'random': return available[Math.floor(Math.random() * available.length)];
      case 'least-used': return available.sort((a, b) => a.successCount - b.successCount)[0];
      case 'fastest': return available.sort((a, b) => (a.latencyMs ?? 9999) - (b.latencyMs ?? 9999))[0];
      case 'fastlane': return this.getFromFastLane() || this.selectByQuality(available);
      case 'quality':
      default: return this.selectByQuality(available);
    }
  }

  /**
   * Request a leased proxy pinned to a specific task.
   * Prioritizes Subscription sources (sub:*) and WARP over Free sources.
   */
  leaseProxy(taskId: string): ProxyEntry | null {
    if (this.activeLeases.has(taskId)) {
      return this.activeLeases.get(taskId)!;
    }

    const available = Array.from(this.proxies.values()).filter(p => p.enabled && p.isHealthy && p.activeConnections === 0);
    if (available.length === 0) return null;

    // Prioritize Subscription nodes, then WARP (ipv6Capable), then rest
    const now = Date.now();
    let candidates = available.filter(p => (now - p.lastUsedAt) > 30000);
    if (candidates.length === 0) candidates = available;

    // Boost scores temporarily for priority sorting
    const sorted = candidates.sort((a, b) => {
      let scoreA = a.qualityScore;
      let scoreB = b.qualityScore;

      // Local system proxy is always preferred
      if (a.source === 'local-mihomo') scoreA += 1000;
      else if (a.ipv6Capable) scoreA += 500; // WARP nodes preferred next
      else if (a.source?.startsWith('sub:')) scoreA += 200; // Then subscriptions
      
      // Local system proxy is always preferred
      if (b.source === 'local-mihomo') scoreB += 1000;
      else if (b.ipv6Capable) scoreB += 500; // WARP nodes preferred next
      else if (b.source?.startsWith('sub:')) scoreB += 200; // Then subscriptions

      return scoreB - scoreA;
    });

    const selected = sorted[0];
    selected.activeConnections++;
    selected.lastUsedAt = Date.now();
    this.activeLeases.set(taskId, selected);
    return selected;
  }

  /**
   * Release a leased proxy and update its quality score based on task success.
   */
  releaseProxy(taskId: string, success: boolean, reason?: string): void {
    const proxy = this.activeLeases.get(taskId);
    if (!proxy) return;
    
    this.activeLeases.delete(taskId);
    if (proxy.activeConnections > 0) proxy.activeConnections--;

    if (success) {
      proxy.qualityScore = Math.min(100, proxy.qualityScore + 10);
      proxy.successCount++;
      proxy.failCount = 0;
    } else {
      proxy.failCount++;
      // Penalize heavily for IP blocks, lightly for timeouts
      const penalty = reason === 'ip_blocked' ? 30 : 10;
      proxy.qualityScore = Math.max(0, proxy.qualityScore - penalty);
      
      if (proxy.failCount >= this.config.maxFailBeforeDisable) {
        proxy.isHealthy = false;
        this.log.warn(`Leased proxy disabled: ${proxy.host}:${proxy.port} (${reason})`);
      }
    }

    // Persist scores
    this.saveDetailedScores();
  }

  private saveDetailedScores(): void {
    const scores: Record<string, number> = {};
    for (const p of this.proxies.values()) {
      scores[`${p.host}:${p.port}`] = p.qualityScore;
    }
    this.historicalScores = scores;
    StorageService.saveProxyScores(scores);
  }

  /** Get best proxy from FastLane (Top-N lowest latency + highest quality) */
  private getFromFastLane(): ProxyEntry | null {
    // Refresh FastLane if empty
    if (this.fastLane.length === 0) this.refreshFastLane();
    const healthy = this.fastLane.filter(p => p.isHealthy && p.enabled);
    if (healthy.length === 0) return null;
    // Round-robin within FastLane
    return healthy[Math.floor(Math.random() * healthy.length)];
  }

  /** Rebuild the FastLane — top N proxies by combined score */
  refreshFastLane(): void {
    const available = Array.from(this.proxies.values())
      .filter(p => p.enabled && p.isHealthy && p.qualityScore > 30)
      .sort((a, b) => {
        // Combined: quality * 0.6 + speed * 0.4
        const scoreA = a.qualityScore * 0.6 + (a.latencyMs ? Math.max(0, 100 - a.latencyMs / 50) : 0) * 0.4;
        const scoreB = b.qualityScore * 0.6 + (b.latencyMs ? Math.max(0, 100 - b.latencyMs / 50) : 0) * 0.4;
        return scoreB - scoreA;
      });

    this.fastLane = available.slice(0, this.config.fastLaneSize);
    if (this.fastLane.length > 0) {
      this.log.info(`FastLane refreshed: ${this.fastLane.map(p => `${p.host}:${p.port}(${p.qualityScore})`).join(', ')}`);
    }
  }

  /** Weighted random by quality */
  private selectByQuality(proxies: ProxyEntry[]): ProxyEntry {
    const total = proxies.reduce((s, p) => s + Math.max(p.qualityScore, 1), 0);
    let roll = Math.random() * total;
    for (const p of proxies) { roll -= Math.max(p.qualityScore, 1); if (roll <= 0) return p; }
    return proxies[proxies.length - 1];
  }

  toPuppeteerArg(proxy: ProxyEntry): string {
    return proxy.protocol === 'socks5'
      ? `--proxy-server=socks5://${proxy.host}:${proxy.port}`
      : `--proxy-server=${proxy.protocol}://${proxy.host}:${proxy.port}`;
  }

  // ─── Feedback ───

  reportSuccess(id: string): void {
    const p = this.proxies.get(id);
    if (p) { 
      p.successCount++; 
      p.failCount = 0; 
      p.isHealthy = true; 
      p.qualityScore = Math.min(100, p.qualityScore + 5); 
      this.saveDetailedScores();
    }
  }

  reportFailure(id: string): void {
    const p = this.proxies.get(id);
    if (p) {
      p.failCount++; 
      p.qualityScore = Math.max(0, p.qualityScore - 15);
      if (p.failCount >= this.config.maxFailBeforeDisable) {
        p.isHealthy = false;
        this.log.warn(`Proxy disabled: ${p.host}:${p.port} (${p.failCount} fails)`);
      }
      this.saveDetailedScores();
    }
  }

  // ─── Health Check & Scoring ───

  async healthCheckAll(): Promise<{ healthy: number; unhealthy: number; purged: number }> {
    const proxies = Array.from(this.proxies.values()).filter(p => p.enabled);
    let healthy = 0, unhealthy = 0, purged = 0;
    const batch = 10;

    for (let i = 0; i < proxies.length; i += batch) {
      const slice = proxies.slice(i, i + batch);
      const results = await Promise.allSettled(slice.map(p => this.checkSingleProxy(p)));

      for (let j = 0; j < results.length; j++) {
        const r = results[j];
        const proxy = slice[j];
        if (r.status === 'fulfilled' && r.value.ok) {
          proxy.isHealthy = true;
          proxy.latencyMs = r.value.latencyMs;
          proxy.lastCheckedAt = new Date().toISOString();
          proxy.externalIP = r.value.externalIP;
          proxy.isAnonymous = r.value.isAnonymous;
          let score = 50;
          if (r.value.latencyMs < 1000) score += 20;
          else if (r.value.latencyMs < 3000) score += 10;
          else score -= 10;
          if (r.value.isAnonymous) score += 20; else score -= 20;
          if (r.value.cfOk) score += 10; else score -= 15;
          proxy.qualityScore = Math.max(0, Math.min(100, score));
          healthy++;
        } else {
          proxy.isHealthy = false;
          proxy.lastCheckedAt = new Date().toISOString();
          proxy.qualityScore = Math.max(0, proxy.qualityScore - 20);
          unhealthy++;
        }
      }
    }

    // Auto-purge: remove proxies with score 0
    if (this.config.autoPurge) {
      const toPurge = Array.from(this.proxies.values()).filter(p => p.qualityScore <= 0);
      for (const p of toPurge) { this.proxies.delete(p.id); purged++; }
      if (purged > 0) this.log.info(`Auto-purged ${purged} dead proxies`);
    }

    // Refresh FastLane after health check
    this.refreshFastLane();
    this.saveDetailedScores();

    this.log.info(`Health check: ${healthy}✓ ${unhealthy}✗ ${purged}🗑 / ${proxies.length} total, pool size: ${this.proxies.size}`);
    return { healthy, unhealthy, purged };
  }

  private async checkSingleProxy(proxy: ProxyEntry): Promise<{
    ok: boolean; latencyMs: number; externalIP?: string; isAnonymous?: boolean; cfOk?: boolean;
  }> {
    const start = Date.now();
    try {
      const resp = await this.fetchViaProxy(proxy, this.config.healthCheckUrl);
      const latencyMs = Date.now() - start;
      let externalIP: string | undefined, isAnonymous = true;
      try {
        const d = JSON.parse(resp);
        externalIP = d.origin?.split(',')[0]?.trim();
        const fwd = d.headers?.['X-Forwarded-For'] || d.headers?.['x-forwarded-for'] || '';
        if (fwd.includes(',')) isAnonymous = false;
      } catch { /* non-JSON OK */ }

      let cfOk = false;
      if (this.config.cloudflareTestUrl) {
        try {
          const cf = await this.fetchViaProxy(proxy, this.config.cloudflareTestUrl, 8000);
          cfOk = !cf.includes('Just a moment') && !cf.includes('Access denied');
        } catch { cfOk = false; }
      }
      return { ok: true, latencyMs, externalIP, isAnonymous, cfOk };
    } catch { return { ok: false, latencyMs: Date.now() - start }; }
  }

  /** Fetch URL THROUGH proxy via HTTP CONNECT tunnel */
  private fetchViaProxy(proxy: ProxyEntry, url: string, timeout?: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const target = new URL(url);
      const ms = timeout || this.config.healthCheckTimeoutMs;
      const authHeader = proxy.username
        ? { 'Proxy-Authorization': 'Basic ' + Buffer.from(`${proxy.username}:${proxy.password || ''}`).toString('base64') }
        : {};

      if (target.protocol === 'https:') {
        const proxyReq = http.request({
          hostname: proxy.host, port: proxy.port,
          method: 'CONNECT', path: `${target.hostname}:${target.port || 443}`,
          headers: { Host: target.hostname, ...authHeader }, timeout: ms,
        });
        proxyReq.on('connect', (res, socket) => {
          if (res.statusCode !== 200) { socket.destroy(); reject(new Error(`CONNECT ${res.statusCode}`)); return; }
          const tls = https.request({
            hostname: target.hostname, path: target.pathname + target.search,
            method: 'GET', socket, timeout: ms,
            headers: { Host: target.hostname, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          } as any, (r) => {
            let d = ''; r.on('data', (c: Buffer) => d += c); r.on('end', () => { socket.destroy(); resolve(d); });
          });
          tls.on('error', (e) => { socket.destroy(); reject(e); }); tls.end();
        });
        proxyReq.on('error', reject);
        proxyReq.on('timeout', () => { proxyReq.destroy(); reject(new Error('timeout')); });
        proxyReq.end();
      } else {
        const req = http.get({
          hostname: proxy.host, port: proxy.port, path: url, timeout: ms,
          headers: { Host: target.hostname, 'User-Agent': 'Mozilla/5.0', ...authHeader },
        }, (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => resolve(d)); });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      }
    });
  }

  // ─── Parsing ───

  private parseURI(uri: string): Omit<ProxyEntry, 'id' | 'failCount' | 'successCount' | 'isHealthy' | 'qualityScore'> | null {
    try {
      const urlMatch = uri.match(/^(https?|socks[45]):\/\/(?:([^:]+):([^@]+)@)?([^:]+):(\d+)$/i);
      if (urlMatch) return {
        protocol: urlMatch[1].toLowerCase().replace('socks4', 'socks5') as ProxyProtocol,
        username: urlMatch[2] || undefined, password: urlMatch[3] || undefined,
        host: urlMatch[4], port: parseInt(urlMatch[5], 10), enabled: true,
        activeConnections: 0, lastUsedAt: 0,
      };
      const simpleMatch = uri.match(/^([^:]+):(\d+)$/);
      if (simpleMatch) return { protocol: 'socks5', host: simpleMatch[1], port: parseInt(simpleMatch[2], 10), enabled: true, activeConnections: 0, lastUsedAt: 0 };
      const authMatch = uri.match(/^([^:]+):(\d+):([^:]+):(.+)$/);
      if (authMatch) return {
        protocol: 'http', host: authMatch[1], port: parseInt(authMatch[2], 10),
        username: authMatch[3], password: authMatch[4], enabled: true,
        activeConnections: 0, lastUsedAt: 0,
      };
      return null;
    } catch { return null; }
  }

  private parseLine(line: string): Omit<ProxyEntry, 'id' | 'failCount' | 'successCount' | 'isHealthy' | 'qualityScore'> | null {
    return this.parseURI(line);
  }

  // ─── Stats ───

  getStats(): {
    total: number; healthy: number; unhealthy: number; disabled: number;
    avgLatencyMs: number; avgQuality: number; fastLaneCount: number;
    sourceCount: number; sources: { name: string; count: number }[];
  } {
    const all = Array.from(this.proxies.values());
    const enabled = all.filter(p => p.enabled);
    const healthy = enabled.filter(p => p.isHealthy);
    const wl = healthy.filter(p => p.latencyMs !== undefined);

    // Count per source
    const sourceCounts = new Map<string, number>();
    for (const p of all) {
      const s = p.source || 'manual';
      sourceCounts.set(s, (sourceCounts.get(s) || 0) + 1);
    }

    return {
      total: all.length, healthy: healthy.length,
      unhealthy: enabled.length - healthy.length,
      disabled: all.length - enabled.length,
      avgLatencyMs: wl.length > 0 ? Math.round(wl.reduce((s, p) => s + (p.latencyMs || 0), 0) / wl.length) : 0,
      avgQuality: healthy.length > 0 ? Math.round(healthy.reduce((s, p) => s + p.qualityScore, 0) / healthy.length) : 0,
      fastLaneCount: this.fastLane.length,
      sourceCount: this.sources.length,
      sources: Array.from(sourceCounts.entries()).map(([name, count]) => ({ name, count })),
    };
  }
}

// ─── Local Tunnel Gateway (ProxyCat-style) ───

/**
 * Creates a local HTTP proxy at 127.0.0.1:port that automatically
 * routes requests through the ProxyPoolService's next available proxy.
 * Tools only need to connect to this fixed local address.
 */
export class ProxyTunnelGateway {
  private server?: http.Server;
  private log = createLogger('ProxyTunnel');
  private currentProxy: ProxyEntry | null = null;
  private requestCount = 0;
  private switchAfterRequests: number;

  constructor(
    private pool: ProxyPoolService,
    private port: number = 10801,
    private host: string = '127.0.0.1',
    switchAfterRequests: number = 10,
  ) {
    this.switchAfterRequests = switchAfterRequests;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer();

      // Handle regular HTTP requests
      this.server.on('request', (req, res) => {
        this.handleHTTPRequest(req, res);
      });

      // Handle CONNECT tunneling (HTTPS)
      this.server.on('connect', (req: any, clientSocket: any, head: any) => {
        this.handleCONNECT(req, clientSocket, head);
      });

      this.server.listen(this.port, this.host, () => {
        this.log.info(`Proxy tunnel gateway listening on ${this.host}:${this.port}`);
        resolve();
      });

      this.server.on('error', (err) => {
        this.log.error('Tunnel gateway error:', err);
        reject(err);
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => { this.log.info('Tunnel gateway stopped'); resolve(); });
      } else resolve();
    });
  }

  /** Get proxy, auto-switch after N requests or on failure */
  private getUpstreamProxy(): ProxyEntry | null {
    if (!this.currentProxy || !this.currentProxy.isHealthy || this.requestCount >= this.switchAfterRequests) {
      this.currentProxy = this.pool.getNext();
      this.requestCount = 0;
      if (this.currentProxy) {
        this.log.info(`Switched upstream proxy to ${this.currentProxy.host}:${this.currentProxy.port}`);
      }
    }
    this.requestCount++;
    return this.currentProxy;
  }

  /** Forward HTTP request through upstream proxy */
  private handleHTTPRequest(clientReq: http.IncomingMessage, clientRes: http.ServerResponse): void {
    const proxy = this.getUpstreamProxy();
    if (!proxy) {
      clientRes.writeHead(503, { 'Content-Type': 'text/plain' });
      clientRes.end('No proxy available');
      return;
    }

    const target = new URL(clientReq.url || '/');
    const proxyReq = http.request({
      hostname: proxy.host, port: proxy.port,
      path: clientReq.url, method: clientReq.method,
      headers: { ...clientReq.headers },
    }, (proxyRes) => {
      clientRes.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(clientRes, { end: true });
    });

    proxyReq.on('error', () => {
      this.pool.reportFailure(proxy.id);
      this.currentProxy = null; // Force switch
      clientRes.writeHead(502, { 'Content-Type': 'text/plain' });
      clientRes.end('Upstream proxy error');
    });

    clientReq.pipe(proxyReq, { end: true });
  }

  /** Forward CONNECT tunnel through upstream proxy */
  private handleCONNECT(req: http.IncomingMessage, clientSocket: net.Socket, head: Buffer): void {
    const proxy = this.getUpstreamProxy();
    if (!proxy) {
      clientSocket.write('HTTP/1.1 503 No Proxy Available\r\n\r\n');
      clientSocket.destroy();
      return;
    }

    const [targetHost, targetPort] = (req.url || '').split(':');
    const proxySocket = net.connect(proxy.port, proxy.host, () => {
      // Send CONNECT to upstream proxy
      proxySocket.write(`CONNECT ${req.url} HTTP/1.1\r\nHost: ${req.url}\r\n`);
      if (proxy.username) {
        const auth = Buffer.from(`${proxy.username}:${proxy.password || ''}`).toString('base64');
        proxySocket.write(`Proxy-Authorization: Basic ${auth}\r\n`);
      }
      proxySocket.write('\r\n');
    });

    let connected = false;
    proxySocket.once('data', (chunk) => {
      if (chunk.toString().includes('200')) {
        connected = true;
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        proxySocket.write(head);
        proxySocket.pipe(clientSocket);
        clientSocket.pipe(proxySocket);
      } else {
        this.pool.reportFailure(proxy.id);
        this.currentProxy = null;
        clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
        clientSocket.destroy();
        proxySocket.destroy();
      }
    });

    proxySocket.on('error', () => {
      this.pool.reportFailure(proxy.id);
      this.currentProxy = null;
      if (!connected) {
        clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      }
      clientSocket.destroy();
    });

    clientSocket.on('error', () => proxySocket.destroy());
  }

  getInfo(): { host: string; port: number; currentProxy: string | null; requestCount: number } {
    return {
      host: this.host, port: this.port,
      currentProxy: this.currentProxy ? `${this.currentProxy.host}:${this.currentProxy.port}` : null,
      requestCount: this.requestCount,
    };
  }
}

// ─── Helpers ───

function fetchText(url: string, timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      timeout,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchText(res.headers.location, timeout).then(resolve).catch(reject);
        return;
      }
      let d = ''; res.on('data', (c) => d += c); res.on('end', () => resolve(d));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function fetchJSON(url: string, options: { method: string; headers: Record<string, string>; body: string }, timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === 'https:' ? https : http;
    const req = client.request({
      hostname: target.hostname, port: target.port, path: target.pathname + target.search,
      method: options.method, headers: options.headers, timeout,
    }, (res) => {
      let d = ''; res.on('data', (c) => d += c); res.on('end', () => resolve(d));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(options.body);
    req.end();
  });
}
