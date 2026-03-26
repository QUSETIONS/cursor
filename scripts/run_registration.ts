/**
 * run_registration.ts — Cursor 自动注册机 (IMAP 模式)
 * 
 * 使用 Outlook 别名 + IMAP 协议直接读取验证码
 * 不需要第二个浏览器窗口！
 * 
 * 运行: npx tsx scripts/run_registration.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import Imap from 'imap';

// ─── Config ───
const NUM_ACCOUNTS = 1;
const SAVE_DIR = path.resolve('data');
const HEADLESS = false;

// Outlook IMAP
const OUTLOOK_EMAIL = 'WandaBrown8051@outlook.com';
const OUTLOOK_PASS = 'scfqujf2914';
const IMAP_HOST = 'imap-mail.outlook.com';
const IMAP_PORT = 993;

// ─── Find Chrome ───
function findChrome(): string {
  const paths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('未找到 Chrome');
}

// ─── Random ───
function randomName(): string {
  const names = ['James','Mary','Robert','Patricia','John','Jennifer','Michael','Linda','David','Elizabeth','William','Barbara'];
  return names[Math.floor(Math.random() * names.length)];
}
function generatePassword(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%';
  let pw = '';
  for (let i = 0; i < 16; i++) pw += chars[Math.floor(Math.random() * chars.length)];
  return pw;
}

// ─── Outlook Alias ───
function generateAlias(index: number): string {
  const slug = `reg${Date.now().toString(36)}${index}`;
  const [local] = OUTLOOK_EMAIL.split('@');
  return `${local}+${slug}@outlook.com`;
}

// ─── IMAP: Poll for Verification Code ───
function pollVerificationCodeViaIMAP(targetEmail: string, timeoutMs: number = 120000): Promise<string | null> {
  return new Promise((resolve) => {
    const start = Date.now();
    let found = false;

    const tryOnce = () => {
      if (found || Date.now() - start > timeoutMs) {
        if (!found) resolve(null);
        return;
      }

      const imap = new Imap({
        user: OUTLOOK_EMAIL,
        password: OUTLOOK_PASS,
        host: IMAP_HOST,
        port: IMAP_PORT,
        tls: true,
        tlsOptions: { rejectUnauthorized: false },
        connTimeout: 15000,
        authTimeout: 15000,
      });

      imap.once('ready', () => {
        imap.openBox('INBOX', true, (err: any) => {
          if (err) {
            console.log(`    ⚠️ IMAP 打开收件箱失败: ${err.message}`);
            imap.end();
            setTimeout(tryOnce, 8000);
            return;
          }

          // Search for recent unread emails
          const searchCriteria = ['UNSEEN', ['SINCE', new Date(start).toISOString().split('T')[0]]];

          imap.search(searchCriteria, (err2: any, uids: number[]) => {
            if (err2 || !uids || uids.length === 0) {
              imap.end();
              const elapsed = Math.round((Date.now() - start) / 1000);
              console.log(`    ⏳ 还没有新邮件... (${elapsed}s)`);
              setTimeout(tryOnce, 8000);
              return;
            }

            // Fetch the most recent emails
            const fetch = imap.fetch(uids.slice(-10), { bodies: ['TEXT', 'HEADER.FIELDS (SUBJECT FROM TO)'], struct: false });

            fetch.on('message', (msg: any) => {
              let bodyText = '';
              let header = '';

              msg.on('body', (stream: any, info: any) => {
                let buf = '';
                stream.on('data', (chunk: Buffer) => { buf += chunk.toString('utf8'); });
                stream.on('end', () => {
                  if (info.which === 'TEXT') bodyText = buf;
                  else header = buf;
                });
              });

              msg.once('end', () => {
                const fullText = header + ' ' + bodyText;
                // Look for Cursor/WorkOS verification code
                if (/cursor|workos|verification|verify|code/i.test(fullText)) {
                  const match = fullText.match(/(\d{6})/);
                  if (match && !found) {
                    found = true;
                    console.log(`    ✅ 找到验证码: ${match[1]}`);
                    resolve(match[1]);
                  }
                }
              });
            });

            fetch.once('end', () => {
              imap.end();
              if (!found) {
                const elapsed = Math.round((Date.now() - start) / 1000);
                console.log(`    ⏳ 有邮件但未找到验证码... (${elapsed}s)`);
                setTimeout(tryOnce, 8000);
              }
            });

            fetch.once('error', (err3: any) => {
              console.log(`    ⚠️ IMAP fetch错误: ${err3.message}`);
              imap.end();
              setTimeout(tryOnce, 8000);
            });
          });
        });
      });

      imap.once('error', (err: any) => {
        console.log(`    ⚠️ IMAP 连接失败: ${err.message}`);
        setTimeout(tryOnce, 8000);
      });

      imap.connect();
    };

    tryOnce();
  });
}

// ─── Single Registration ───
async function registerOne(index: number): Promise<{ email: string; password: string; token: string; success: boolean; error?: string }> {
  const puppeteer = require('puppeteer-extra');
  const StealthPlugin = require('puppeteer-extra-plugin-stealth');
  puppeteer.use(StealthPlugin());

  const chromePath = findChrome();
  let browser: any = null;

  try {
    const aliasEmail = generateAlias(index);
    const password = generatePassword();
    console.log(`\n[${index}] 📧 别名邮箱: ${aliasEmail}`);
    console.log(`[${index}] 🔑 密码: ${password}`);

    // 1. 启动浏览器
    console.log(`[${index}] 🌐 启动浏览器 (直连)...`);
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: HEADLESS,
      args: [
        '--no-sandbox', '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars', '--window-size=1280,800',
      ],
      defaultViewport: { width: 1280, height: 800 },
    });

    const page = await browser.newPage();

    // 2. 打开注册页
    console.log(`[${index}] 📄 打开 Cursor 注册页...`);
    await page.goto('https://authenticator.cursor.sh/sign-up', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await new Promise(r => setTimeout(r, 3000));

    // Take screenshot for debugging
    await page.screenshot({ path: path.join(SAVE_DIR, `step1_signup_page_${index}.png`) });

    // 3. 填写邮箱
    console.log(`[${index}] ✏️ 填写邮箱: ${aliasEmail}`);
    let emailInput = null;
    for (const sel of ['input[name="identifier"]', 'input[name="email"]', 'input[type="email"]', 'input[autocomplete="email"]']) {
      emailInput = await page.$(sel);
      if (emailInput) break;
    }
    if (!emailInput) {
      await page.waitForSelector('input', { timeout: 15000 });
      for (const sel of ['input[name="identifier"]', 'input[type="email"]', 'input']) {
        emailInput = await page.$(sel);
        if (emailInput) break;
      }
    }
    if (!emailInput) {
      await page.screenshot({ path: path.join(SAVE_DIR, `error_no_email_input_${index}.png`) });
      throw new Error('未找到邮箱输入框');
    }

    await Promise.race([emailInput.click({ clickCount: 3 }), new Promise(r => setTimeout(r, 3000))]).catch(()=>{});
    await Promise.race([emailInput.type(aliasEmail, { delay: 60 }), new Promise(r => setTimeout(r, 5000))]).catch(()=>{});
    await new Promise(r => setTimeout(r, 500));

    const sub1 = await page.$('button[type="submit"]');
    if (sub1) await Promise.race([sub1.click(), new Promise(r => setTimeout(r, 3000))]).catch(()=>{}); 
    else await page.keyboard.press('Enter');

    // Wait for navigation or DOM change
    await Promise.race([
      page.waitForNavigation({ timeout: 15000 }),
      new Promise(r => setTimeout(r, 15000))
    ]).catch(() => {});
    await new Promise(r => setTimeout(r, 3000));
    
    try {
      await page.screenshot({ path: path.join(SAVE_DIR, `step2_after_email_${index}.png`), timeout: 5000 });
    } catch {}

    // 4. 填写姓名密码
    console.log(`[${index}] 📝 填写注册信息...`);
    const firstName = randomName();
    const lastName = randomName();

    const fnInput = await page.$('input[name="firstName"], input[name="first_name"]');
    if (fnInput) { await fnInput.click({ clickCount: 3 }); await fnInput.type(firstName, { delay: 40 }); }

    const lnInput = await page.$('input[name="lastName"], input[name="last_name"]');
    if (lnInput) { await lnInput.click({ clickCount: 3 }); await lnInput.type(lastName, { delay: 40 }); }

    const pwInput = await page.$('input[name="password"], input[type="password"]');
    if (pwInput) { await pwInput.click({ clickCount: 3 }); await pwInput.type(password, { delay: 30 }); }

    await page.screenshot({ path: path.join(SAVE_DIR, `step3_filled_form_${index}.png`) });

    const sub2 = await page.$('button[type="submit"]');
    if (sub2) {
      await Promise.race([sub2.click(), new Promise(r => setTimeout(r, 5000))]).catch(()=>{});
    } else {
      await page.keyboard.press('Enter');
    }
    
    await Promise.race([
      page.waitForNavigation({ timeout: 15000 }),
      new Promise(r => setTimeout(r, 15000))
    ]).catch(() => {});
    await new Promise(r => setTimeout(r, 3000));
    
    try {
      await page.screenshot({ path: path.join(SAVE_DIR, `step4_after_submit_${index}.png`), timeout: 5000 });
    } catch {}

    // 5. 通过 IMAP 读取验证码 (不需要第二个浏览器!)
    console.log(`[${index}] 📬 通过 IMAP 读取 Outlook 验证码 (最长 120 秒)...`);
    const code = await pollVerificationCodeViaIMAP(aliasEmail);

    if (!code) {
      await page.screenshot({ path: path.join(SAVE_DIR, `error_no_code_${index}.png`) });
      throw new Error('验证码等待超时');
    }

    // 6. 填入验证码
    console.log(`[${index}] 🔢 填入验证码: ${code}`);
    let codeInput = null;
    for (const sel of ['input[name="code"]', 'input[type="text"][maxlength="6"]', 'input[name="otp"]', 'input[autocomplete="one-time-code"]']) {
      codeInput = await page.$(sel);
      if (codeInput) break;
    }

    if (codeInput) {
      await codeInput.click({ clickCount: 3 });
      await codeInput.type(code, { delay: 80 });
      const sub3 = await page.$('button[type="submit"]');
      if (sub3) await sub3.click(); else await page.keyboard.press('Enter');
    } else {
      const digitInputs = await page.$$('input[maxlength="1"]');
      if (digitInputs.length >= 6) {
        for (let i = 0; i < 6; i++) {
          await digitInputs[i].type(code[i], { delay: 50 });
        }
      }
    }

    await page.waitForNavigation({ timeout: 15000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 3000));
    await page.screenshot({ path: path.join(SAVE_DIR, `step5_after_code_${index}.png`) });

    // 7. 提取 Token
    console.log(`[${index}] 🔑 提取 Token...`);
    await page.goto('https://www.cursor.com/settings', { waitUntil: 'networkidle2', timeout: 30000 });
    const cookies = await page.cookies();
    const accessToken = cookies.find((c: any) => c.name === 'WorkosCursorSessionToken')?.value || '';

    if (accessToken) {
      console.log(`[${index}] ✅ 注册成功！Token: ${accessToken.substring(0, 30)}...`);
    } else {
      console.log(`[${index}] ⚠️ 注册可能成功但未获取到 Token，检查截图`);
      await page.screenshot({ path: path.join(SAVE_DIR, `step6_settings_${index}.png`) });
    }

    return { email: aliasEmail, password, token: accessToken, success: true };
  } catch (err: any) {
    console.error(`[${index}] ❌ 失败: ${err.message}`);
    return { email: '', password: '', token: '', success: false, error: err.message };
  } finally {
    if (browser) { try { await browser.close(); } catch {} }
  }
}

// ─── Main ───
async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  🚀 Nirvana 自动注册机 — IMAP 模式');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  📧 主邮箱: ${OUTLOOK_EMAIL}`);
  console.log(`  📬 验证码: IMAP 协议直读 (无需第二浏览器)`);
  console.log(`  📊 计划注册: ${NUM_ACCOUNTS} 个账号`);

  if (!fs.existsSync(SAVE_DIR)) fs.mkdirSync(SAVE_DIR, { recursive: true });
  const results: any[] = [];

  for (let i = 0; i < NUM_ACCOUNTS; i++) {
    console.log(`\n════ 账号 ${i + 1}/${NUM_ACCOUNTS} ════`);
    const result = await registerOne(i + 1);
    results.push(result);

    if (result.success) {
      const line = `${result.email}----${result.password}----${result.token}\n`;
      fs.appendFileSync(path.join(SAVE_DIR, 'accounts.txt'), line, 'utf-8');
    }

    if (i < NUM_ACCOUNTS - 1) {
      console.log(`\n⏳ 等待 5 秒...`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  const success = results.filter(r => r.success).length;
  console.log('\n═══════════════════════════════════════════════════');
  console.log(`  📊 注册结果汇总`);
  console.log(`     尝试: ${NUM_ACCOUNTS}`);
  console.log(`     成功: ${success}`);
  console.log(`     失败: ${NUM_ACCOUNTS - success}`);
  if (success > 0) console.log(`     保存: ${path.join(SAVE_DIR, 'accounts.txt')}`);
  console.log(`     截图: ${SAVE_DIR}`);
  console.log('═══════════════════════════════════════════════════');
}

main().catch(console.error);
