import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { execSync, spawn } from 'child_process';

const NUM_INSTANCES = 10;
const START_PORT = 9001;
const WORK_DIR = path.join(__dirname, '..', 'warp-plus-bin');

async function downloadWarpPlus() {
  if (!fs.existsSync(WORK_DIR)) {
    fs.mkdirSync(WORK_DIR, { recursive: true });
  }

  const exePath = path.join(WORK_DIR, 'warp-plus.exe');
  if (fs.existsSync(exePath)) {
    console.log('✅ warp-plus.exe already exists, skipping download.');
    return exePath;
  }

  console.log('🔍 Fetching latest warp-plus release info...');
  const releaseRes = await axios.get('https://api.github.com/repos/bepass-org/warp-plus/releases/latest');
  const asset = releaseRes.data.assets.find((a: any) => a.name.includes('windows-amd64') && a.name.endsWith('.zip'));
  
  if (!asset) {
    throw new Error('❌ Could not find Windows AMD64 release for warp-plus!');
  }

  const zipPath = path.join(WORK_DIR, asset.name);
  console.log(`⬇️ Downloading ${asset.name} from ${asset.browser_download_url}...`);
  
  const response = await axios({
    url: asset.browser_download_url,
    method: 'GET',
    responseType: 'arraybuffer'
  });
  fs.writeFileSync(zipPath, response.data);
  console.log('✅ Download complete. Extracting via PowerShell...');
  
  execSync(`powershell -Command "Expand-Archive -Force -Path '${zipPath}' -DestinationPath '${WORK_DIR}'"`, { stdio: 'inherit' });
  
  if (fs.existsSync(exePath)) {
    console.log('✅ Extraction successful.');
  } else {
    throw new Error('❌ Extraction failed! warp-plus.exe not found.');
  }
  return exePath;
}

async function startPool(exePathStr: string) {
  console.log(`🚀 Starting ${NUM_INSTANCES} IPv6 WARP instances on ports ${START_PORT} to ${START_PORT + NUM_INSTANCES - 1}...`);
  
  // Kill existing
  try { execSync('taskkill /F /IM warp-plus.exe /T 2>nul'); } catch (e) {}
  
  for (let i = 0; i < NUM_INSTANCES; i++) {
    const port = START_PORT + i;
    const nodeDir = path.join(WORK_DIR, `node_${port}`);
    if (!fs.existsSync(nodeDir)) fs.mkdirSync(nodeDir);
    
    const nodeExe = path.join(nodeDir, 'warp-plus.exe');
    if (!fs.existsSync(nodeExe)) fs.copyFileSync(exePathStr, nodeExe);

    const logFile = path.join(nodeDir, 'out.log');
    const out = fs.openSync(logFile, 'a');
    
    const args = ['-b', `127.0.0.1:${port}`];
    const child = spawn(nodeExe, args, {
      cwd: nodeDir,
      detached: true,
      stdio: ['ignore', out, out]
    });
    child.unref();
    console.log(` > Started Node ${i+1} on 127.0.0.1:${port} (Logging to ${nodeDir}\\out.log)`);
  }
  
  console.log('\n🎉 Native WARP IPv6 Proxy Pool is successfully running in the background!');
  console.log(`👉 You can now connect the registration machine to 127.0.0.1:${START_PORT} - ${START_PORT + NUM_INSTANCES - 1}`);
}

async function main() {
  try {
    const exePath = await downloadWarpPlus();
    await startPool(exePath);
  } catch (err) {
    console.error(err);
  }
}

main();
