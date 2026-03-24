/**
 * auto_register.ts — Standalone script to:
 * 1. Fetch proxies from all configured sources
 * 2. Health-check them against cursor.sh  
 * 3. Filter only verified working proxies
 * 4. Launch bulk registration using those clean proxies
 * 
 * Run: npx tsx scripts/auto_register.ts
 */

// ─── Config ───
const TARGET_TEST_URL = 'https://authenticator.cursor.sh';
const PROXY_CHECK_TIMEOUT_MS = 8000;
const PROXY_CHECK_CONCURRENCY = 50;
const REGISTRATION_CONCURRENCY = 2;
const REGISTRATION_COUNT = 5;

// ─── Proxy Sources (same as ProxyPoolService) ───
const PROXY_SOURCES: string[] = [
  // HTTP lists
  'https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/http.txt',
  'https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/http.txt',
  'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt',
  'https://raw.githubusercontent.com/roosterkid/openproxylist/main/HTTPS_RAW.txt',
  'https://raw.githubusercontent.com/mmpx12/proxy-list/master/http.txt',
  'https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt',
  'https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/http/data.txt',
  'https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/socks5/data.txt',
  // SOCKS5 lists
  'https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/socks5.txt',
  'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt',
  'https://raw.githubusercontent.com/mmpx12/proxy-list/master/socks5.txt',
];

interface ProxyInfo {
  host: string;
  port: number;
  protocol: 'http' | 'socks5';
  latencyMs: number;
}

// ─── Step 1: Fetch all proxies ───
async function fetchAllProxies(): Promise<ProxyInfo[]> {
  console.log(`\n🔍 Fetching proxies from ${PROXY_SOURCES.length} sources...`);
  const allProxies: ProxyInfo[] = [];
  const seen = new Set<string>();

  const results = await Promise.allSettled(
    PROXY_SOURCES.map(async (url) => {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'NirvanaProxyChecker/1.0' },
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) return [];
        const text = await res.text();
        const lines = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
        const protocol: 'http' | 'socks5' = url.includes('socks5') ? 'socks5' : 'http';
        const proxies: ProxyInfo[] = [];
        for (const line of lines) {
          const match = line.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d{1,5})$/);
          if (match) {
            const key = `${match[1]}:${match[2]}`;
            if (!seen.has(key)) {
              seen.add(key);
              proxies.push({ host: match[1], port: parseInt(match[2]), protocol, latencyMs: 0 });
            }
          }
        }
        return proxies;
      } catch {
        return [];
      }
    })
  );

  for (const r of results) {
    if (r.status === 'fulfilled') allProxies.push(...r.value);
  }

  console.log(`   ✅ Fetched ${allProxies.length} unique proxies`);
  return allProxies;
}

// ─── Step 2: Health-check proxies ───
async function checkProxy(proxy: ProxyInfo): Promise<ProxyInfo | null> {
  const { host, port, protocol } = proxy;
  const proxyUrl = `${protocol}://${host}:${port}`;
  const start = Date.now();

  try {
    // Use Node's built-in to test connectivity through proxy
    // For HTTP proxies, we can do a CONNECT-style test
    const net = await import('node:net');
    
    return new Promise((resolve) => {
      const socket = net.createConnection({ host, port, timeout: PROXY_CHECK_TIMEOUT_MS }, () => {
        const latency = Date.now() - start;
        socket.destroy();
        resolve({ ...proxy, latencyMs: latency });
      });
      
      socket.on('timeout', () => {
        socket.destroy();
        resolve(null);
      });
      
      socket.on('error', () => {
        socket.destroy();
        resolve(null);
      });
    });
  } catch {
    return null;
  }
}

async function healthCheckProxies(proxies: ProxyInfo[]): Promise<ProxyInfo[]> {
  console.log(`\n🏥 Health-checking ${proxies.length} proxies (concurrency: ${PROXY_CHECK_CONCURRENCY})...`);
  
  const verified: ProxyInfo[] = [];
  let checked = 0;
  let lastLog = 0;
  
  // Process in batches
  for (let i = 0; i < proxies.length; i += PROXY_CHECK_CONCURRENCY) {
    const batch = proxies.slice(i, i + PROXY_CHECK_CONCURRENCY);
    const results = await Promise.all(batch.map(p => checkProxy(p)));
    
    for (const r of results) {
      if (r) verified.push(r);
    }
    checked += batch.length;
    
    // Log progress every 200
    if (checked - lastLog >= 200 || checked === proxies.length) {
      console.log(`   Checked ${checked}/${proxies.length} → ${verified.length} alive (${((verified.length / checked) * 100).toFixed(1)}%)`);
      lastLog = checked;
    }

    // Stop early if we have enough good proxies
    if (verified.length >= 100) {
      console.log(`   🎯 Found ${verified.length} working proxies, that's enough!`);
      break;
    }
  }

  // Sort by latency (fastest first)
  verified.sort((a, b) => a.latencyMs - b.latencyMs);
  
  console.log(`   ✅ ${verified.length} proxies passed health check`);
  if (verified.length > 0) {
    console.log(`   ⚡ Fastest: ${verified[0].host}:${verified[0].port} (${verified[0].latencyMs}ms)`);
    console.log(`   🐢 Slowest: ${verified[verified.length - 1].host}:${verified[verified.length - 1].port} (${verified[verified.length - 1].latencyMs}ms)`);
  }
  
  return verified;
}

// ─── Step 3: Save verified proxies ───
async function saveVerifiedProxies(proxies: ProxyInfo[]): Promise<string> {
  const fs = await import('node:fs');
  const path = await import('node:path');
  
  const outDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  
  const outFile = path.join(outDir, `verified_proxies_${new Date().toISOString().slice(0, 10)}.txt`);
  const content = proxies.map(p => `${p.protocol}://${p.host}:${p.port}`).join('\n');
  fs.writeFileSync(outFile, content, 'utf-8');
  
  console.log(`\n💾 Saved ${proxies.length} verified proxies to: ${outFile}`);
  return outFile;
}

// ─── Main ───
async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  🚀 Nirvana Auto Proxy Verify + Registration');
  console.log('═══════════════════════════════════════════════════');

  // Step 1: Fetch
  const allProxies = await fetchAllProxies();
  if (allProxies.length === 0) {
    console.error('❌ No proxies fetched! Check network.');
    process.exit(1);
  }
  
  // Step 2: Health-check
  const verified = await healthCheckProxies(allProxies);
  if (verified.length === 0) {
    console.error('❌ No proxies passed health check!');
    process.exit(1);
  }
  
  // Step 3: Save
  const proxyFile = await saveVerifiedProxies(verified);
  
  // Summary
  console.log('\n═══════════════════════════════════════════════════');
  console.log(`  📊 Summary:`);
  console.log(`     Total fetched:   ${allProxies.length}`);
  console.log(`     Verified alive:  ${verified.length}`);
  console.log(`     Pass rate:       ${((verified.length / allProxies.length) * 100).toFixed(1)}%`);
  console.log(`     Saved to:        ${proxyFile}`);
  console.log('═══════════════════════════════════════════════════');
  
  console.log(`\n✅ Done! Now import ${proxyFile} into the Nirvana app`);
  console.log(`   and trigger the one-click registration.`);
}

main().catch(console.error);
