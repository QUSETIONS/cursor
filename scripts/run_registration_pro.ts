import fs from 'node:fs';
import path from 'node:path';
import Imap from 'imap';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

puppeteer.use(StealthPlugin());

// ─── Config ───
const CAPSOLVER_API_KEY = process.env.CAPSOLVER_API_KEY || ''; // 必须提供
const TURNSTILE_SITEKEY = '0x4AAAAAAAMNIvC45A4Wjjln';
const SIGNUP_URL = 'https://authenticator.cursor.sh/sign-up';
const SUB2API_ADMIN = 'http://localhost:8080/api/v1/admin/accounts/batch';
const SUB2API_TOKEN = process.env.SUB2API_API_KEY || ''; // 可选

const OUTLOOK_EMAIL = process.env.IMAP_USER || '';
const OUTLOOK_PASS = process.env.IMAP_PASS || '';
const NUM_ACCOUNTS = 1;
const SAVE_DIR = path.resolve('data');

// ... Random Helpers ...
const randomName = () => ['James','Mary','Robert','Patricia','John','Jennifer','Michael','Linda','David','Elizabeth'][Math.floor(Math.random()*10)];
const generatePassword = () => 'Abc' + Math.random().toString(36).slice(-8) + '!@#';
const generateAlias = (idx: number) => {
  const catchAllDomain = process.env.CATCH_ALL_DOMAIN;
  if (catchAllDomain) {
    const prefix = Math.random().toString(36).substring(2, 10);
    return `${prefix}@${catchAllDomain}`;
  }
  const [local] = OUTLOOK_EMAIL.split('@');
  return `${local}+reg${Date.now().toString(36)}${idx}@outlook.com`;
};

// ─── Nirvana Foundry & Ghost Fleet ───
const FOUNDRY_API = 'http://localhost:8191/v1';
const GHOST_FLEET_PROXY = 'http://127.0.0.1:7897'; // Force route through the local Clash/v2ray subscription (Bypasses ERR_PROXY_CONNECTION_FAILED)

async function solveTurnstileLocally(): Promise<string> {
  console.log(`⏳ 呼叫内网铸造厂 (The Foundry) 请求底层特征提取...`);
  
  const startTime = Date.now();
  const res = await axios.post(FOUNDRY_API, {
    cmd: 'request.get',
    url: SIGNUP_URL,
    maxTimeout: 60000,
    proxy: GHOST_FLEET_PROXY // 让打码机本身也走幽灵舰队轮转IP
  }).catch(e => { 
    const reason = e.response?.data ? JSON.stringify(e.response.data) : e.message;
    throw new Error(`Foundry API 连接失败: ${reason}`); 
  });

  if (res.data?.solution?.token) {
    console.log(`✅ The Foundry 解码成功! 耗时: ${((Date.now() - startTime)/1000).toFixed(1)}s`);
    return res.data.solution.token;
  }
  
  throw new Error('The Foundry 解析失败或超时: ' + JSON.stringify(res.data));
}

// ─── IMAP Verification ───
// [IMAP Helper omitted here for brevity, assumes identical to previous run_registration.ts]
async function pollVerificationCodeViaIMAP(targetEmail: string, timeoutMs: number = 120000): Promise<string | null> {
  return new Promise((resolve) => {
    const start = Date.now();
    let found = false;
    const tryOnce = () => {
      if (found || Date.now() - start > timeoutMs) { if (!found) resolve(null); return; }
      const imap = new Imap({ user: OUTLOOK_EMAIL, password: OUTLOOK_PASS, host: 'imap.gmail.com', port: 993, tls: true, tlsOptions: { rejectUnauthorized: false }, connTimeout: 10000, authTimeout: 10000 });
      imap.once('ready', () => {
        imap.openBox('INBOX', true, (err: any) => {
          if (err) { imap.end(); setTimeout(tryOnce, 8000); return; }
          imap.search(['UNSEEN', ['SINCE', new Date(start).toISOString().split('T')[0]]], (err2: any, uids: number[]) => {
            if (err2 || !uids || uids.length === 0) { imap.end(); setTimeout(tryOnce, 8000); return; }
            const fetch = imap.fetch(uids.slice(-3), { bodies: ['TEXT', 'HEADER.FIELDS (SUBJECT FROM TO)'], struct: false });
            fetch.on('message', (msg: any) => {
              let bodyText = '';
              msg.on('body', (stream: any) => { stream.on('data', (c: any) => { bodyText += c.toString('utf8'); }); });
              msg.once('end', () => {
                const match = bodyText.match(/(\d{6})/);
                if (match && !found) { found = true; resolve(match[1]); }
              });
            });
            fetch.once('end', () => { imap.end(); if (!found) setTimeout(tryOnce, 8000); });
          });
        });
      });
      imap.once('error', () => setTimeout(tryOnce, 8000));
      imap.connect();
    };
    tryOnce();
  });
}

// ─── Main Logic ───
async function registerOne(index: number) {
  let browser: any = null;
  const aliasEmail = generateAlias(index);
  const password = generatePassword();
  console.log(`\n[${index}] 📧 别名: ${aliasEmail} | 🔑 密码: ${password}`);

  try {
    // 1. Solve Turnstile using our own local infra
    const turnstileToken = await solveTurnstileLocally();

    // 2. Start browser protected by The Ghost Fleet
    const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    browser = await puppeteer.launch({ 
      executablePath: chromePath, 
      headless: true, 
      args: ['--no-sandbox', `--proxy-server=${GHOST_FLEET_PROXY}`] 
    });
    const page = await browser.newPage();

    // 3. ABORT TURNSTILE JS LOAD! (This prevents Cloudflare from dropping CDP!)
    await page.setRequestInterception(true);
    page.on('request', (req: any) => {
      if (req.url().includes('turnstile') || req.url().includes('challenge-platform')) {
        console.log(`[${index}] 🛡️ 拦截原生 Turnstile (防掉链): ${req.url().substring(0, 50)}...`);
        req.abort();
      } else {
        req.continue();
      }
    });

    // 4. Navigate & Inject
    console.log(`[${index}] 📄 打开注册面并注入 Token...`);
    await page.goto(SIGNUP_URL, { waitUntil: 'domcontentloaded' });
    
    // Inject Token exactly where WorkOS/Cursor expects it
    await page.evaluate((token: string) => {
      // 隐形注入cf-turnstile-response
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = 'cf-turnstile-response';
      input.value = token;
      document.body.appendChild(input);

      // 如果有可见表单，也塞进去
      const forms = document.querySelectorAll('form');
      forms.forEach(f => {
        const i2 = document.createElement('input');
        i2.type = 'hidden';
        i2.name = 'cf-turnstile-response';
        i2.value = token;
        f.appendChild(i2);
      });
    }, turnstileToken);

    // 5. Fill Email
    let emailInput = await page.waitForSelector('input[name="identifier"], input[type="email"]');
    await emailInput?.type(aliasEmail, { delay: 50 });
    await page.keyboard.press('Enter');
    await page.waitForNavigation({ waitUntil: 'networkidle2' });

    // 6. Fill Details
    const fn = await page.$('input[name="firstName"]');
    if (fn) await fn.type(randomName());
    const ln = await page.$('input[name="lastName"]');
    if (ln) await ln.type(randomName());
    const pw = await page.$('input[name="password"]');
    if (pw) await pw.type(password);
    await page.keyboard.press('Enter');
    await page.waitForNavigation({ waitUntil: 'networkidle2' });

    // 7. Verification Code via IMAP
    console.log(`[${index}] 📬 等待 IMAP 验证码...`);
    const code = await pollVerificationCodeViaIMAP(aliasEmail);
    if (!code) throw new Error('验证码超时');
    
    // 8. Submit Code
    const codeInputs = await page.$$('input[maxlength="1"]');
    for (let i = 0; i < 6; i++) {
        if (codeInputs[i]) await codeInputs[i].type(code[i], { delay: 30 });
    }
    await page.waitForNavigation({ timeout: 15000 }).catch(()=>{});

    // 9. Extract Token
    await page.goto('https://www.cursor.com/settings', { waitUntil: 'networkidle2' });
    const cookies = await page.cookies();
    const token = cookies.find(c => c.name === 'WorkosCursorSessionToken')?.value || '';
    
    if (token) {
      console.log(`[${index}] 🎉 注册成功: ${token.substring(0,25)}...`);
      return { success: true, email: aliasEmail, password, token };
    }
    throw new Error('未获取到Token');

  } catch (err: any) {
    console.error(`[${index}] ❌ 失败: ${err.message}`);
    return { success: false, error: err.message };
  } finally {
    if (browser) await browser.close();
  }
}

async function run() {
  const account = await registerOne(1);
  if (account.success) {
    fs.appendFileSync(path.join(SAVE_DIR, 'accounts.txt'), `${account.email}----${account.password}----${account.token}\n`);
    
    // Auto Export to Sub2API
    try {
      if (SUB2API_TOKEN) {
        console.log('🔄 正在同步至 Sub2API网关...');
        await axios.post(SUB2API_ADMIN, {
          accounts: [{
            account_type: 'cursor',
            credentials: { email: account.email, password: account.password, token: account.token },
            status: 'active'
          }]
        }, { headers: { Authorization: `Bearer ${SUB2API_TOKEN}` } });
        console.log('✅ 成功注入 Sub2API 网关池！');
      }
    } catch (e: any) {
      console.log('⚠️ Sub2API 同步失败, 请确认服务已启动且 Token 正确。');
    }
  }
}

run().catch(console.error);
