import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { execSync, spawn } from 'child_process';

const NUM_INSTANCES = 10; // 10 WARP nodes for proper IP diversity in the Ghost Fleet
const START_PORT = 9001;
const WORK_DIR = path.join(__dirname, '..', 'wireproxy-bin');

async function downloadAsset(repo: string, matchFn: (name: string) => boolean, outName: string) {
  const outPath = path.join(WORK_DIR, outName);
  if (fs.existsSync(outPath)) {
    console.log(`✅ ${outName} already exists.`);
    return outPath;
  }
  
  console.log(`🔍 Fetching latest release for ${repo}...`);
  const res = await axios.get(`https://api.github.com/repos/${repo}/releases/latest`);
  const asset = res.data.assets.find((a: any) => matchFn(a.name));
  
  if (!asset) throw new Error(`❌ Asset not found for ${repo}`);
  console.log(`⬇️ Downloading ${asset.name}...`);
  
  const response = await axios.get(asset.browser_download_url, { responseType: 'arraybuffer' });
  fs.writeFileSync(outPath, response.data);
  return outPath;
}

async function prepareBinaries() {
  if (!fs.existsSync(WORK_DIR)) fs.mkdirSync(WORK_DIR, { recursive: true });

  // Download wgcf
  const wgcfPath = await downloadAsset(
    'ViRb3/wgcf',
    (name) => name.includes('windows_amd64.exe'),
    'wgcf.exe'
  );

  // Download wireproxy
  const wireproxyZip = await downloadAsset(
    'windtf/wireproxy',
    (name) => name.includes('windows_amd64.tar.gz'),
    'wireproxy.tar.gz'
  );

  const wireproxyExe = path.join(WORK_DIR, 'wireproxy.exe');
  if (!fs.existsSync(wireproxyExe)) {
    console.log('✅ Extracting wireproxy...');
    execSync(`tar -xf wireproxy.tar.gz`, { cwd: WORK_DIR });
  }

  return { wgcfPath, wireproxyExe };
}

async function setupAndStartNodes({ wgcfPath, wireproxyExe }: any) {
  try { execSync('taskkill /F /IM wireproxy.exe /T 2>nul'); } catch (e) {}

  for (let i = 0; i < NUM_INSTANCES; i++) {
    const port = START_PORT + i;
    const nodeDir = path.join(WORK_DIR, `node_${port}`);
    if (!fs.existsSync(nodeDir)) fs.mkdirSync(nodeDir);

    const confPath = path.join(nodeDir, `wgcf-profile.conf`);

    // Only generate if it doesn't already exist to save time
    if (!fs.existsSync(confPath)) {
      console.log(`\n⚙️ Generating Cloudflare WARP identity for Port ${port}...`);
      // Clean up previous registration files in this directory
      if (fs.existsSync(path.join(nodeDir, 'wgcf-account.toml'))) fs.unlinkSync(path.join(nodeDir, 'wgcf-account.toml'));
      
      execSync(`"${wgcfPath}" register --accept-tos`, { cwd: nodeDir, stdio: 'ignore' });
      execSync(`"${wgcfPath}" generate`, { cwd: nodeDir, stdio: 'ignore' });
      
      // Patch the generated conf to use a randomized, unblocked Cloudflare WARP Endpoint to bypass GFW IP Blacklisting
      let confData = fs.readFileSync(confPath, 'utf8');
      
      const subnets = ['162.159.192.', '162.159.193.', '162.159.195.', '188.114.96.', '188.114.97.', '188.114.98.', '188.114.99.'];
      const randomIp = subnets[Math.floor(Math.random() * subnets.length)] + (Math.floor(Math.random() * 254) + 1);
      const randomPort = [2408, 1701, 500, 4500][Math.floor(Math.random() * 4)];
      
      // Replace the blocked generic Endpoint with our randomized evasion Endpoint
      confData = confData.replace(/Endpoint = .+/g, `Endpoint = ${randomIp}:${randomPort}`);
      
      // Add the final SOCKS5 listener configuration for wireproxy
      confData += `\n\n[Socks5]\nBindAddress = 127.0.0.1:${port}\n`;
      fs.writeFileSync(confPath, confData);
      console.log(`✅ Patch successful for node ${port} (GFW Evasion Endpoint: ${randomIp}:${randomPort}).`);
    }

    const logFile = path.join(nodeDir, 'out.log');
    const out = fs.openSync(logFile, 'a');
    
    // Spawn wireproxy
    const child = spawn(wireproxyExe, ['--config', confPath], {
      cwd: nodeDir,
      detached: true,
      stdio: ['ignore', out, out]
    });
    child.unref();
    console.log(`🚀 Started Native WireProxy WARP IPv6 Node on 127.0.0.1:${port}`);
  }

  console.log(`\n🎉 The unbreakable chained IPv6 proxy pool is fully operational! Port 9001 - ${START_PORT + NUM_INSTANCES - 1}`);
}

async function main() {
  try {
    const binaries = await prepareBinaries();
    await setupAndStartNodes(binaries);
  } catch (err) {
    console.error('Crash Details:', err);
  }
}

main();
