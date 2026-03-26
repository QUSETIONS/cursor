/**
 * boot_full_proxy_pool.ts — 三层动态代理池统一引导程序
 * 
 * 一键启动完整代理基础设施:
 *   Tier 1: Cloudflare WARP 矩阵 (零成本, 高信誉)
 *   Tier 2: 机场订阅转代理池 (需要订阅 URL)
 *   Tier 3: 免费公开代理 (GitHub 聚合源)
 *   + 商业住宅代理 (如有 API Key)
 * 
 * 运行: npx tsx scripts/boot_full_proxy_pool.ts
 * 
 * 环境变量 (可选):
 *   SUBSCRIPTION_URLS — 逗号分隔的机场订阅链接
 *   WEBSHARE_API_KEY — WebShare API Token
 */

import { ProxyPoolService, ProxiflyCDNSource, LocalFileSource } from '../electron/services/ProxyPoolService';
import { ProxyGateway } from '../electron/services/proxy/ProxyGateway';
import { SubscriptionProxySource } from '../electron/services/proxy/SubscriptionProxySource';
import { Logger } from '../electron/utils/Logger';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const log = Logger.create('ProxyPoolBoot');

// ─── Config ───
const WARP_NODES = 10;
const WARP_BASE_PORT = 9001;
const GATEWAY_PORT = 50000;
const DATA_DIR = path.resolve('data');

// ─── Tier 1: WARP 矩阵 ───

function loadWarpNodes(pool: ProxyPoolService): number {
  log.info('━━━ Tier 1: Cloudflare WARP 矩阵 ━━━');

  // 检测已部署的 WARP 节点
  let loaded = 0;
  for (let i = 0; i < WARP_NODES; i++) {
    const port = WARP_BASE_PORT + i;
    // 只加载存在配置文件的节点 (已部署的)
    const confPath = path.resolve('wireproxy-bin', `node_${port}`, 'wgcf-profile.conf');
    if (fs.existsSync(confPath)) {
      pool.addProxy({
        protocol: 'socks5',
        host: '127.0.0.1',
        port,
        provider: 'CloudflareWARP',
        country: 'auto',
        enabled: true,
        activeConnections: 0,
        lastUsedAt: 0,
        ipv6Capable: true,
      });
      loaded++;
    }
  }

  if (loaded > 0) {
    log.info(`  ✅ 加载 ${loaded} 个 WARP SOCKS5 节点 (Port ${WARP_BASE_PORT}-${WARP_BASE_PORT + loaded - 1})`);
  } else {
    log.warn('  ⚠️ 未检测到已部署的 WARP 节点');
    log.warn('  💡 运行 `npx tsx scripts/deploy_wireproxy_warp.ts` 来部署 WARP 矩阵');
  }

  return loaded;
}

// ─── Tier 2: 机场订阅 ───

function loadSubscriptionSources(pool: ProxyPoolService): number {
  log.info('━━━ Tier 2: 机场订阅代理源 ━━━');

  const subUrls = process.env.SUBSCRIPTION_URLS;
  if (!subUrls) {
    // 检查本地配置文件
    const subFile = path.join(DATA_DIR, 'subscriptions.txt');
    if (fs.existsSync(subFile)) {
      const lines = fs.readFileSync(subFile, 'utf-8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
      let count = 0;
      for (const line of lines) {
        const [url, name] = line.split('|').map(s => s.trim());
        if (url) {
          pool.addSource(new SubscriptionProxySource({ url, name: name || `Airport-${count + 1}` }));
          count++;
        }
      }
      if (count > 0) {
        log.info(`  ✅ 从 ${subFile} 加载 ${count} 个订阅源`);
        return count;
      }
    }
    
    log.warn('  ⚠️ 未配置订阅链接');
    log.warn('  💡 设置环境变量 SUBSCRIPTION_URLS 或创建 data/subscriptions.txt');
    log.warn('     格式: 每行一个订阅URL，可选 | 分隔名称');
    log.warn('     例: https://xxx.com/sub?token=abc | Airport-1');
    return 0;
  }

  const urls = subUrls.split(',').map(s => s.trim()).filter(s => s.length > 0);
  for (let i = 0; i < urls.length; i++) {
    pool.addSource(new SubscriptionProxySource({ url: urls[i], name: `Airport-${i + 1}` }));
  }
  log.info(`  ✅ 加载 ${urls.length} 个订阅源`);
  return urls.length;
}

// ─── Tier 3: 免费公开代理 ───

function loadFreeProxySources(pool: ProxyPoolService): void {
  log.info('━━━ Tier 3: 免费公开代理聚合器 ━━━');

  // 加载已验证的本地缓存
  const verifiedFile = path.join(DATA_DIR, 'verified_proxies.txt');
  if (fs.existsSync(verifiedFile)) {
    pool.addSource(new LocalFileSource(verifiedFile, 'socks5'));
    log.info(`  ✅ 加载本地验证缓存: ${verifiedFile}`);
  }

  // 加载 GitHub CDN 聚合源
  pool.addSource(new ProxiflyCDNSource());
  log.info('  ✅ 加载 ProxiflyCDN 多源聚合器 (20+ GitHub 源)');
}

// ─── 商业代理 (可选) ───

async function loadCommercialProviders(pool: ProxyPoolService): Promise<void> {
  const webshareKey = process.env.WEBSHARE_API_KEY;

  // Optional: WARP Zero-Cost FastLane proxies
  await pool.addSource({
    name: 'warp-matrix',
    fetchIntervalMs: 60 * 60 * 1000,
    async fetch() {
      // Return the 10 WARP nodes assuming wireproxy is running
      return Array.from({ length: 10 }, (_, i) => `socks5://127.0.0.1:${9001 + i}`);
    }
  });

  // Inject user's local Clash/Mihomo system proxy as Tier 0 guaranteed fallback
  log.info('━━━ Tier 0: 本地系统代理 (Mihomo) ━━━');
  await pool.addSource({
    name: 'local-mihomo',
    fetchIntervalMs: 86400000,
    async fetch() {
      // 7897 is the mixed port for clash-verge/mihomo
      return ['http://127.0.0.1:7897', 'socks5://127.0.0.1:7897'];
    }
  });

  if (!webshareKey) return;

  log.info('━━━ Tier 4: 商业代理 (WebShare) ━━━');
  pool.addSource({
    name: 'webshare',
    fetchIntervalMs: 300_000, // 5 min
    async fetch() {
      try {
        const res = await globalThis.fetch('https://proxy.webshare.io/api/v2/proxy/list/?mode=direct&page=1&page_size=100', {
          headers: { Authorization: `Token ${webshareKey}` },
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) return [];
        const data = await res.json() as any;
        const results = data.results || [];
        return results.map((p: any) =>
          `socks5://${p.username}:${p.password}@${p.proxy_address}:${p.port}`
        );
      } catch {
        return [];
      }
    }
  });
  log.info('  ✅ WebShare 商业代理源已挂载');
}

// ─── Main ───

async function main() {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  🌐 Nirvana 三层动态代理池 — 统一引导程序           ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  const startTime = Date.now();

  // 初始化代理池
  const pool = new ProxyPoolService({
    strategy: 'quality',
    healthCheckIntervalMs: 90_000,  // 90s 健康检查
    autoPurge: true,
  });

  // ══ 加载三层代理源 ══

  const warpCount = loadWarpNodes(pool);
  const subCount = loadSubscriptionSources(pool);
  loadFreeProxySources(pool);
  loadCommercialProviders(pool);

  // 启动代理池（开始健康检查和定时拉取）
  pool.start();

  // 启动 Ghost Fleet Gateway
  log.info('\n━━━ 启动 Ghost Fleet Gateway ━━━');
  const gateway = new ProxyGateway(pool, GATEWAY_PORT);
  gateway.start();

  // 初次采集所有源
  log.info('\n━━━ 执行首次全网采集 ━━━');
  const fetchResults = await pool.fetchAllSources();

  // 健康检查
  log.info('\n━━━ 执行全池健康检查 ━━━');
  await pool.healthCheckAll();

  // ══ 输出统计报告 ══

  const stats = pool.getStats();
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  📊 代理池状态报告                                  ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  ⏱️  耗时:       ${elapsed}s`);
  console.log(`║  📦 总代理:      ${stats.total}`);
  console.log(`║  ✅ 健康:        ${stats.healthy}`);
  console.log(`║  ❌ 不健康:      ${stats.unhealthy}`);
  console.log(`║  ⏳ 平均延迟:    ${stats.avgLatencyMs}ms`);
  console.log(`║  ⭐ 平均质量:    ${stats.avgQuality}/100`);
  console.log(`║  🚀 FastLane:    ${stats.fastLaneCount} 个精英节点`);
  console.log('║');
  console.log('║  📡 数据来源:');
  for (const src of stats.sources) {
    const icon = src.name.includes('WARP') ? '🛡️' : src.name.includes('sub:') ? '✈️' : src.name.includes('webshare') ? '💰' : '🌍';
    console.log(`║    ${icon} ${src.name}: ${src.count} 个`);
  }
  console.log('║');
  console.log(`║  🌐 Ghost Fleet Gateway: http://127.0.0.1:${GATEWAY_PORT}`);
  console.log('╚══════════════════════════════════════════════════════╝');

  if (warpCount === 0 && subCount === 0) {
    console.log('\n⚠️  提示: 当前仅依赖免费公开代理。建议：');
    console.log('   1. 运行 `npx tsx scripts/deploy_wireproxy_warp.ts` 部署 WARP 矩阵');
    console.log('   2. 创建 data/subscriptions.txt 添加你的机场订阅链接');
  }

  console.log('\n✅ 代理池已就绪！所有网络工具的代理设置为: http://127.0.0.1:50000');

  // 保持进程运行
  process.on('SIGINT', () => {
    log.info('收到关闭信号，停止代理池...');
    gateway.stop();
    pool.stop();
    process.exit(0);
  });
}

main().catch(console.error);
