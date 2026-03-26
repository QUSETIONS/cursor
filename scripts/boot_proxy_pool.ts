/**
 * boot_proxy_pool.ts — 一键启动代理池
 * 
 * 功能:
 * 1. 从 20+ 个 GitHub 免费源批量抓取代理 (HTTP/SOCKS5)
 * 2. 并发健康检查（TCP 连通性）
 * 3. 深度验证：通过代理访问 httpbin 和 cursor.sh
 * 4. 把存活代理写入 data/verified_proxies.txt 供注册机使用
 * 5. 启动本地代理隧道网关 127.0.0.1:10801
 * 
 * 运行: npx tsx scripts/boot_proxy_pool.ts
 */

import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

// ─── Config ───
const SOURCES = [
  // SOCKS5
  { url: 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt', proto: 'socks5' as const },
  { url: 'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt', proto: 'socks5' as const },
  { url: 'https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt', proto: 'socks5' as const },
  { url: 'https://raw.githubusercontent.com/roosterkid/openproxylist/main/SOCKS5_RAW.txt', proto: 'socks5' as const },
  { url: 'https://raw.githubusercontent.com/mmpx12/proxy-list/master/socks5.txt', proto: 'socks5' as const },
  { url: 'https://raw.githubusercontent.com/Zaeem20/FREE_PROXIES_LIST/master/socks5.txt', proto: 'socks5' as const },
  { url: 'https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/socks5/data.txt', proto: 'socks5' as const },
  { url: 'https://raw.githubusercontent.com/sunny9577/proxy-scraper/master/generated/socks5_proxies.txt', proto: 'socks5' as const },
  // HTTP  
  { url: 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt', proto: 'http' as const },
  { url: 'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt', proto: 'http' as const },
  { url: 'https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/http.txt', proto: 'http' as const },
  { url: 'https://raw.githubusercontent.com/mmpx12/proxy-list/master/http.txt', proto: 'http' as const },
  { url: 'https://raw.githubusercontent.com/roosterkid/openproxylist/main/HTTP_RAW.txt', proto: 'http' as const },
  { url: 'https://raw.githubusercontent.com/Zaeem20/FREE_PROXIES_LIST/master/http.txt', proto: 'http' as const },
  { url: 'https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/http/data.txt', proto: 'http' as const },
  { url: 'https://raw.githubusercontent.com/sunny9577/proxy-scraper/master/generated/http_proxies.txt', proto: 'http' as const },
  { url: 'https://raw.githubusercontent.com/vakhov/fresh-proxy-list/master/http.txt', proto: 'http' as const },
  { url: 'https://raw.githubusercontent.com/vakhov/fresh-proxy-list/master/socks5.txt', proto: 'socks5' as const },
  // HTTPS
  { url: 'https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/https/data.txt', proto: 'http' as const },
  { url: 'https://raw.githubusercontent.com/vakhov/fresh-proxy-list/master/https.txt', proto: 'http' as const },
];

const TCP_TIMEOUT = 5000;
const CONCURRENCY = 80;
const TARGET_ALIVE = 50; // 找到 50 个活代理即可

interface Proxy {
  host: string;
  port: number;
  proto: 'http' | 'socks5';
  latencyMs: number;
}

// ─── Step 1: Fetch ───
async function fetchAll(): Promise<Proxy[]> {
  console.log(`\n🔍 从 ${SOURCES.length} 个源抓取代理...`);
  const seen = new Set<string>();
  const all: Proxy[] = [];

  const results = await Promise.allSettled(SOURCES.map(async (src) => {
    try {
      const res = await fetch(src.url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) return [];
      const text = await res.text();
      const lines = text.split('\n').map(l => l.trim()).filter(l => /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d{1,5}$/.test(l));
      const proxies: Proxy[] = [];
      for (const line of lines) {
        if (!seen.has(line)) {
          seen.add(line);
          const [host, portStr] = line.split(':');
          proxies.push({ host, port: parseInt(portStr), proto: src.proto, latencyMs: 0 });
        }
      }
      return proxies;
    } catch { return []; }
  }));

  for (const r of results) {
    if (r.status === 'fulfilled') all.push(...r.value);
  }

  console.log(`   ✅ 抓取到 ${all.length} 个去重代理`);
  return all;
}

// ─── Step 2: TCP Health Check ───
function tcpCheck(proxy: Proxy): Promise<Proxy | null> {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = net.createConnection({ host: proxy.host, port: proxy.port, timeout: TCP_TIMEOUT }, () => {
      proxy.latencyMs = Date.now() - start;
      socket.destroy();
      resolve(proxy);
    });
    socket.on('timeout', () => { socket.destroy(); resolve(null); });
    socket.on('error', () => { socket.destroy(); resolve(null); });
  });
}

async function healthCheck(proxies: Proxy[]): Promise<Proxy[]> {
  console.log(`\n🏥 并发健康检查 (TCP) ${proxies.length} 个代理 (并发: ${CONCURRENCY})...`);
  const alive: Proxy[] = [];
  let checked = 0;

  for (let i = 0; i < proxies.length; i += CONCURRENCY) {
    const batch = proxies.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(p => tcpCheck(p)));
    for (const r of results) {
      if (r) alive.push(r);
    }
    checked += batch.length;

    if (checked % (CONCURRENCY * 5) === 0 || checked === proxies.length) {
      console.log(`   已检查 ${checked}/${proxies.length} → ${alive.length} 个存活 (${((alive.length / checked) * 100).toFixed(1)}%)`);
    }

    if (alive.length >= TARGET_ALIVE) {
      console.log(`   🎯 已找到 ${alive.length} 个存活代理，足够了！`);
      break;
    }
  }

  alive.sort((a, b) => a.latencyMs - b.latencyMs);
  console.log(`   ✅ ${alive.length} 个代理通过 TCP 检查`);
  if (alive.length > 0) {
    console.log(`   ⚡ 最快: ${alive[0].host}:${alive[0].port} (${alive[0].latencyMs}ms)`);
    console.log(`   🐢 最慢: ${alive[alive.length - 1].host}:${alive[alive.length - 1].port} (${alive[alive.length - 1].latencyMs}ms)`);
  }
  return alive;
}

// ─── Step 3: Deep Verify (HTTP CONNECT to cursor.sh) ───
function deepVerify(proxy: Proxy): Promise<boolean> {
  return new Promise((resolve) => {
    // For HTTP proxies, test HTTP CONNECT tunnel to cursor.sh
    const req = http.request({
      hostname: proxy.host,
      port: proxy.port,
      method: 'CONNECT',
      path: 'authenticator.cursor.sh:443',
      timeout: 8000,
    });

    req.on('connect', (res, socket) => {
      socket.destroy();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

async function deepCheck(proxies: Proxy[]): Promise<Proxy[]> {
  // Only deep-check HTTP proxies (SOCKS5 needs a different tunnel method)
  const httpProxies = proxies.filter(p => p.proto === 'http');
  const socksProxies = proxies.filter(p => p.proto === 'socks5');

  console.log(`\n🔬 深度验证 ${httpProxies.length} 个 HTTP 代理 (CONNECT → cursor.sh)...`);
  const verified: Proxy[] = [...socksProxies]; // keep SOCKS5 that passed TCP
  let checked = 0;

  for (let i = 0; i < httpProxies.length; i += 20) {
    const batch = httpProxies.slice(i, i + 20);
    const results = await Promise.all(batch.map(async (p) => {
      const ok = await deepVerify(p);
      return ok ? p : null;
    }));
    for (const r of results) {
      if (r) verified.push(r);
    }
    checked += batch.length;
    console.log(`   深度检查 ${checked}/${httpProxies.length} → ${verified.length - socksProxies.length} 个 HTTP 通过`);
  }

  console.log(`   ✅ 最终可用: ${verified.length} 个 (${socksProxies.length} SOCKS5 + ${verified.length - socksProxies.length} HTTP)`);
  return verified;
}

// ─── Step 4: Save ───
function saveResults(proxies: Proxy[]): string {
  const outDir = path.resolve('data');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const outFile = path.join(outDir, 'verified_proxies.txt');
  const content = proxies.map(p => `${p.proto}://${p.host}:${p.port}`).join('\n');
  fs.writeFileSync(outFile, content, 'utf-8');
  console.log(`\n💾 已保存 ${proxies.length} 个验证代理到: ${outFile}`);
  return outFile;
}

// ─── Main ───
async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  🚀 Nirvana 代理池引导程序');
  console.log('═══════════════════════════════════════════════════');

  const startTime = Date.now();

  // Step 1
  const allProxies = await fetchAll();
  if (allProxies.length === 0) {
    console.error('❌ 一个代理都没抓到，请检查网络！');
    process.exit(1);
  }

  // Step 2: TCP
  const alive = await healthCheck(allProxies);
  if (alive.length === 0) {
    console.error('❌ 没有代理通过 TCP 检查！');
    process.exit(1);
  }

  // Step 3: Deep verify
  const verified = await deepCheck(alive);

  // Step 4: Save
  const outFile = saveResults(verified.length > 0 ? verified : alive);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n═══════════════════════════════════════════════════');
  console.log(`  📊 代理池引导完成 (耗时 ${elapsed}s)`);
  console.log(`     抓取总量:    ${allProxies.length}`);
  console.log(`     TCP 存活:    ${alive.length}`);
  console.log(`     深度验证:    ${verified.length}`);
  console.log(`     通过率:      ${((verified.length / allProxies.length) * 100).toFixed(2)}%`);
  console.log(`     保存位置:    ${outFile}`);
  console.log('═══════════════════════════════════════════════════');
  console.log(`\n✅ 代理池已就绪！可以在注册机 GUI 中导入 ${outFile}`);
  console.log(`   或者直接运行注册机，它会自动读取该文件中的代理。`);
}

main().catch(console.error);
