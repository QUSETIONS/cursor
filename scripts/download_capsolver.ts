import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import crypto from 'node:crypto';

const EXT_DIR = path.resolve('assets/capsolver_ext');
const ZIP_PATH = path.resolve('assets/capsolver.zip');

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return downloadFile(res.headers.location!, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Status: ${res.statusCode}`));
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', err => { fs.unlink(dest, () => {}); reject(err); });
  });
}

async function run() {
  if (!fs.existsSync(path.dirname(ZIP_PATH))) fs.mkdirSync(path.dirname(ZIP_PATH), { recursive: true });
  
  // Download specific release version or use unzipper (but Windows has tar natively on Win10/11)
  console.log('Downloading Capsolver Extension v1.17.0...');
  await downloadFile('https://github.com/capsolver/capsolver-browser-extension/releases/download/v1.17.0/CapSolver.Browser.Extension-chrome-v1.17.0.zip', ZIP_PATH);
  console.log('Download complete.');
}

run().catch(console.error);
