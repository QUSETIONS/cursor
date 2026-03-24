/**
 * EmailServiceFactory — Inspired by any-auto-register's multi-email service design
 * Factory for creating email service instances: MoeMail, Laoudo, DuckMail, CF Worker, IMAP
 */

import { createLogger } from '../utils/Logger';

export interface TempEmail {
  address: string;
  token?: string;  // session token for polling
}

export interface EmailServiceConfig {
  type: EmailServiceType;
  apiUrl?: string;       // MoeMail/CF Worker instance URL
  apiKey?: string;       // CF Worker admin password / addy.io API token
  domain?: string;       // Custom domain for Laoudo/CF Worker
  imapHost?: string;
  imapPort?: number;
  imapUser?: string;
  imapPass?: string;
  addyUsername?: string; // addy.io username for catch-all subdomain
}

export type EmailServiceType = 'moemail' | 'laoudo' | 'duckmail' | 'cfworker' | 'imap' | 'addyio' | 'mailtm';

export interface IEmailService {
  readonly type: EmailServiceType;
  readonly displayName: string;
  createEmail(prefix?: string): Promise<TempEmail>;
  waitForCode(email: string, options?: WaitOptions): Promise<string | null>;
  cleanup?(email: string): Promise<void>;
}

export interface WaitOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  senderPatterns?: string[];
  codePattern?: RegExp;
}

const DEFAULT_WAIT: WaitOptions = {
  timeoutMs: 120000,
  pollIntervalMs: 5000,
  codePattern: /(\d{6})/,
};

// ─── MoeMail (cloudflare_temp_email based) ───
class MoeMailService implements IEmailService {
  type: EmailServiceType = 'moemail';
  displayName = 'MoeMail (推荐)';
  private log = createLogger('MoeMail');
  private apiUrl: string;

  constructor(apiUrl: string = 'https://moemail.app') {
    this.apiUrl = apiUrl.replace(/\/$/, '');
  }

  async createEmail(prefix?: string): Promise<TempEmail> {
    try {
      const res = await fetch(`${this.apiUrl}/api/mail/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix }),
      });
      const data = await res.json() as any;
      if (data.address) {
        this.log.info(`Created temp email: ${data.address}`);
        return { address: data.address, token: data.token };
      }
      throw new Error(data.message || 'Failed to create email');
    } catch (err) {
      this.log.error('Create email failed:', err);
      throw err;
    }
  }

  async waitForCode(email: string, opts?: WaitOptions): Promise<string | null> {
    const options = { ...DEFAULT_WAIT, ...opts };
    const start = Date.now();

    while (Date.now() - start < options.timeoutMs!) {
      try {
        const res = await fetch(`${this.apiUrl}/api/mail/messages?address=${encodeURIComponent(email)}`);
        const data = await res.json() as any;
        const messages = Array.isArray(data) ? data : data.messages || [];

        for (const msg of messages) {
          const body = msg.text || msg.html || msg.body || '';
          const match = body.match(options.codePattern!);
          if (match) {
            this.log.info(`Got code: ${match[1]} from MoeMail`);
            return match[1];
          }
        }
      } catch { /* retry */ }

      await this.delay(options.pollIntervalMs!);
    }

    return null;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }
}

// ─── DuckMail (duck.com temp email) ───
class DuckMailService implements IEmailService {
  type: EmailServiceType = 'duckmail';
  displayName = 'DuckMail';
  private log = createLogger('DuckMail');

  async createEmail(): Promise<TempEmail> {
    // DuckDuckGo Email Protection API
    try {
      const res = await fetch('https://quack.duckduckgo.com/api/email/addresses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json() as any;
      if (data.address) {
        return { address: `${data.address}@duck.com`, token: data.token };
      }
      throw new Error('Failed to create DuckMail address');
    } catch (err) {
      this.log.error('DuckMail create failed:', err);
      throw err;
    }
  }

  async waitForCode(email: string, opts?: WaitOptions): Promise<string | null> {
    const options = { ...DEFAULT_WAIT, ...opts };
    const start = Date.now();

    while (Date.now() - start < options.timeoutMs!) {
      try {
        const res = await fetch(`https://quack.duckduckgo.com/api/email/messages`, {
          headers: { 'Authorization': `Bearer ${email}` },
        });
        const data = await res.json() as any;
        const messages = Array.isArray(data) ? data : [];

        for (const msg of messages) {
          const body = msg.body || msg.text || '';
          const match = body.match(options.codePattern!);
          if (match) return match[1];
        }
      } catch { /* retry */ }

      await this.delay(options.pollIntervalMs!);
    }
    return null;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }
}

// ─── CF Worker (cloudflare_temp_email self-hosted) ───
class CFWorkerEmailService implements IEmailService {
  type: EmailServiceType = 'cfworker';
  displayName = 'Cloudflare 自建邮箱';
  private log = createLogger('CFWorker');
  private apiUrl: string;
  private apiKey: string;
  private domain: string;

  constructor(apiUrl: string, apiKey: string, domain: string) {
    this.apiUrl = apiUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.domain = domain;
  }

  async createEmail(prefix?: string): Promise<TempEmail> {
    const username = prefix || `user_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const address = `${username}@${this.domain}`;

    try {
      await fetch(`${this.apiUrl}/api/new_address`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-auth': this.apiKey,
        },
        body: JSON.stringify({ name: username }),
      });
      this.log.info(`Created CF Worker email: ${address}`);
      return { address };
    } catch (err) {
      this.log.error('CF Worker create failed:', err);
      throw err;
    }
  }

  async waitForCode(email: string, opts?: WaitOptions): Promise<string | null> {
    const options = { ...DEFAULT_WAIT, ...opts };
    const start = Date.now();

    while (Date.now() - start < options.timeoutMs!) {
      try {
        const res = await fetch(`${this.apiUrl}/api/mails?address=${encodeURIComponent(email)}`, {
          headers: { 'x-admin-auth': this.apiKey },
        });
        const data = await res.json() as any;
        const messages = Array.isArray(data) ? data : data.mails || [];

        for (const msg of messages) {
          const body = msg.raw || msg.text || msg.html || '';
          const match = body.match(options.codePattern!);
          if (match) return match[1];
        }
      } catch { /* retry */ }

      await this.delay(options.pollIntervalMs!);
    }
    return null;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }
}

// ─── Laoudo (fixed domain email) ───
class LaoudoEmailService implements IEmailService {
  type: EmailServiceType = 'laoudo';
  displayName = 'Laoudo 固定域名';
  private log = createLogger('Laoudo');
  private domain: string;

  constructor(domain: string) {
    this.domain = domain;
  }

  async createEmail(prefix?: string): Promise<TempEmail> {
    const username = prefix || `reg_${Date.now().toString(36)}`;
    const address = `${username}@${this.domain}`;
    this.log.info(`Created Laoudo email: ${address}`);
    return { address };
  }

  async waitForCode(email: string, opts?: WaitOptions): Promise<string | null> {
    this.log.warn('Laoudo waitForCode requires IMAP integration');
    return null;
  }
}

// ─── addy.io (unlimited free aliases via catch-all subdomain) ───
class AddyIoService implements IEmailService {
  type: EmailServiceType = 'addyio';
  displayName = 'addy.io 无限别名';
  private log = createLogger('AddyIo');
  private username: string;
  private apiToken?: string;
  private imapConfig?: { host: string; port: number; user: string; pass: string };

  constructor(username: string, apiToken?: string, imapConfig?: { host: string; port: number; user: string; pass: string }) {
    this.username = username;
    this.apiToken = apiToken;
    this.imapConfig = imapConfig;
  }

  async createEmail(prefix?: string): Promise<TempEmail> {
    // addy.io catch-all: ANY prefix @username.anonaddy.com auto-creates & forwards
    const slug = prefix || `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const address = `${slug}@${this.username}.anonaddy.com`;
    this.log.info(`Created addy.io alias: ${address}`);
    return { address };
  }

  async waitForCode(email: string, opts?: WaitOptions): Promise<string | null> {
    const options = { ...DEFAULT_WAIT, ...opts };
    const start = Date.now();

    // If we have an API token, use addy.io's API to check forwarded messages
    if (this.apiToken) {
      while (Date.now() - start < options.timeoutMs!) {
        try {
          // addy.io API: search aliases for the specific email address
          const res = await fetch(`https://app.addy.io/api/v1/aliases?filter[search]=${encodeURIComponent(email)}`, {
            headers: { 'Authorization': `Bearer ${this.apiToken}`, 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          });
          const data = await res.json() as any;
          const aliases = data?.data || [];
          if (aliases.length > 0 && aliases[0].emails_forwarded > 0) {
            this.log.info(`addy.io: ${email} has ${aliases[0].emails_forwarded} forwarded emails — check IMAP inbox`);
            // The actual code is in the forwarded inbox; break to let IMAP handle it
            break;
          }
        } catch (err) {
          this.log.warn('addy.io API check failed, will retry', err);
        }
        await this.delay(options.pollIntervalMs!);
      }
    }

    // Fallback: the code arrives in the real IMAP inbox (forwarding destination)
    // The caller should set up ImapService to read from the forwarding mailbox
    this.log.info(`addy.io: poll IMAP inbox for code sent to ${email}`);
    return null; // Caller chains with ImapService.waitForVerificationCode()
  }

  private delay(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }
}

// ─── mail.tm (free REST API temp mail, no IMAP needed) ───
class MailTmService implements IEmailService {
  type: EmailServiceType = 'mailtm';
  displayName = 'mail.tm API 临时邮箱';
  private log = createLogger('MailTm');
  private baseUrl = 'https://api.mail.tm';
  private tokens: Map<string, string> = new Map(); // email -> JWT token

  async createEmail(_prefix?: string): Promise<TempEmail> {
    try {
      // 1. Get available domains
      const domRes = await fetch(`${this.baseUrl}/domains`);
      const domData = await domRes.json() as any;
      const domains = domData['hydra:member'] || domData;
      if (!domains || domains.length === 0) throw new Error('No mail.tm domains available');
      const domain = domains[0].domain;

      // 2. Create account with random address
      const slug = `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const address = `${slug}@${domain}`;
      const password = `NirvP@ss${Date.now()}`;

      const createRes = await fetch(`${this.baseUrl}/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, password }),
      });
      if (!createRes.ok) {
        const errText = await createRes.text();
        throw new Error(`mail.tm account creation failed: ${errText}`);
      }

      // 3. Login to get JWT token
      const loginRes = await fetch(`${this.baseUrl}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, password }),
      });
      const loginData = await loginRes.json() as any;
      const token = loginData.token;
      if (!token) throw new Error('mail.tm login failed — no token returned');

      this.tokens.set(address, token);
      this.log.info(`Created mail.tm account: ${address}`);
      return { address, token };
    } catch (err) {
      this.log.error('mail.tm create failed:', err);
      throw err;
    }
  }

  async waitForCode(email: string, opts?: WaitOptions): Promise<string | null> {
    const options = { ...DEFAULT_WAIT, ...opts };
    const token = this.tokens.get(email) || opts?.senderPatterns?.[0]; // hack: pass token via senderPatterns if needed
    if (!token) {
      this.log.error(`No JWT token for ${email}`);
      return null;
    }

    const start = Date.now();
    while (Date.now() - start < options.timeoutMs!) {
      try {
        const res = await fetch(`${this.baseUrl}/messages`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        const data = await res.json() as any;
        const messages = data['hydra:member'] || data || [];

        for (const msg of messages) {
          // Fetch full message to get body
          const fullRes = await fetch(`${this.baseUrl}/messages/${msg.id}`, {
            headers: { 'Authorization': `Bearer ${token}` },
          });
          const fullMsg = await fullRes.json() as any;
          const body = fullMsg.text || fullMsg.html || '';
          const match = body.match(options.codePattern!);
          if (match) {
            this.log.info(`Got code: ${match[1]} from mail.tm`);
            return match[1];
          }
        }
      } catch { /* retry */ }

      await this.delay(options.pollIntervalMs!);
    }
    return null;
  }

  async cleanup(email: string): Promise<void> {
    const token = this.tokens.get(email);
    if (token) {
      try {
        await fetch(`${this.baseUrl}/accounts/me`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` },
        });
        this.tokens.delete(email);
        this.log.info(`Cleaned up mail.tm account: ${email}`);
      } catch { /* ignore */ }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }
}

// ─── Outlook Web Alias (browser-based email reading) ───
// Microsoft blocks basic IMAP auth; we read emails via Outlook Web UI instead
class ImapAliasEmailService implements IEmailService {
  type: EmailServiceType = 'imap';
  displayName = 'Outlook Web 别名邮箱';
  private log = createLogger('OutlookWeb');
  private baseEmail: string;
  private password: string;
  private domain: string;
  private browser: any = null;
  private mailPage: any = null;
  private loggedIn = false;

  constructor(config: EmailServiceConfig) {
    this.baseEmail = config.imapUser || '';
    this.password = config.imapPass || '';
    this.domain = this.baseEmail.split('@')[1] || 'outlook.com';
    this.log.info(`Outlook Web alias service configured: base=${this.baseEmail}`);
  }

  async createEmail(prefix?: string): Promise<TempEmail> {
    const local = this.baseEmail.split('@')[0];
    const suffix = prefix || `reg${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const aliasEmail = `${local}+${suffix}@${this.domain}`;
    this.log.info(`Created alias email: ${aliasEmail}`);
    return { address: aliasEmail };
  }

  async waitForCode(email: string, opts?: WaitOptions): Promise<string | null> {
    const options = { ...DEFAULT_WAIT, ...opts };
    const start = Date.now();

    this.log.info(`Polling Outlook Web for verification code to ${email}...`);

    try {
      // Ensure browser session is ready
      if (!this.loggedIn) {
        await this.ensureLogin();
      }

      while (Date.now() - start < options.timeoutMs!) {
        try {
          const code = await this.searchOutlookWeb(email, options.codePattern!);
          if (code) {
            this.log.info(`✅ Got verification code: ${code}`);
            return code;
          }
        } catch (err) {
          this.log.warn(`Outlook Web poll error: ${err instanceof Error ? err.message : err}`);
          // Try re-login if session expired
          if (String(err).includes('closed') || String(err).includes('detach')) {
            this.loggedIn = false;
            try { await this.ensureLogin(); } catch { /* ignore */ }
          }
        }
        await this.delay(5000);
      }
    } catch (err) {
      this.log.error(`Outlook Web login failed: ${err instanceof Error ? err.message : err}`);
    }

    this.log.warn(`Verification code timeout after ${options.timeoutMs! / 1000}s`);
    return null;
  }

  private async ensureLogin(): Promise<void> {
    // Session reuse — if already logged in, verify session is still alive
    if (this.loggedIn && this.mailPage) {
      try {
        const url = this.mailPage.url();
        if (url.includes('outlook.live.com') || url.includes('mail')) {
          this.log.info('♻️ Reusing existing Outlook Web session');
          return;
        }
      } catch {
        // Page closed or crashed — need fresh login
        this.loggedIn = false;
      }
    }

    const puppeteer = require('puppeteer-extra');
    const StealthPlugin = require('puppeteer-extra-plugin-stealth');
    puppeteer.use(StealthPlugin());

    // Close previous browser if any
    if (this.browser) {
      try { await this.browser.close(); } catch { /* ignore */ }
      this.browser = null;
      this.mailPage = null;
    }

    // Retry login up to 2 times
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        this.log.info(`🔑 Logging into Outlook Web... (attempt ${attempt}/2)`);
        await this._doLogin(puppeteer);
        this.loggedIn = true;
        this.log.info('✅ Outlook Web login successful, inbox ready');
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.warn(`Login attempt ${attempt} failed: ${msg}`);

        // Screenshot for debugging
        await this._screenshotOnError(`login_fail_${attempt}`);

        // Close browser for fresh retry
        if (this.browser) {
          try { await this.browser.close(); } catch { /* ignore */ }
          this.browser = null;
          this.mailPage = null;
        }

        if (attempt === 2) throw err;
        await this.delay(3000); // Brief cooldown before retry
      }
    }
  }

  private async _doLogin(puppeteer: any): Promise<void> {
    // Find Chrome path
    const fs = require('fs');
    const chromePaths = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
    ];
    const executablePath = chromePaths.find((p: string) => fs.existsSync(p)) || undefined;

    this.browser = await puppeteer.launch({
      executablePath,
      channel: executablePath ? undefined : 'chrome',
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1200,800',
      ],
    });

    this.mailPage = await this.browser.newPage();
    await this.mailPage.setViewport({ width: 1200, height: 800 });
    // Set a longer default navigation timeout
    this.mailPage.setDefaultNavigationTimeout(60000);

    // Step 1: Navigate to login page
    await this.mailPage.goto('https://login.live.com/', {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });
    await this.delay(1500);

    // Step 2: Enter email
    await this.mailPage.waitForSelector('input[type="email"], input[name="loginfmt"]', {
      timeout: 15000,
      visible: true,
    });
    // Clear and type email
    await this.mailPage.evaluate(() => {
      const el = document.querySelector('input[type="email"], input[name="loginfmt"]') as HTMLInputElement;
      if (el) { el.value = ''; el.focus(); }
    });
    await this.mailPage.type('input[type="email"], input[name="loginfmt"]', this.baseEmail, { delay: 40 });
    await this.delay(300);

    // Step 3: Click Next with waitForNavigation
    // MS login uses <button>, <input>, or dynamic elements — try multiple strategies
    let nextBtn = await this.mailPage.$('#idSIButton9');
    if (!nextBtn) nextBtn = await this.mailPage.$('input[type="submit"][value="Next"]');
    if (!nextBtn) nextBtn = await this.mailPage.$('button[type="submit"]');
    if (!nextBtn) {
      // XPath fallback: find button containing text 'Next'
      const [xpathBtn] = await this.mailPage.$$('::-p-xpath(//button[contains(text(), "Next")] | //input[@value="Next"])');
      nextBtn = xpathBtn || null;
    }
    if (!nextBtn) throw new Error('Next button not found');

    await Promise.all([
      this.mailPage.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {}),
      nextBtn.click(),
    ]);
    // Extra wait for animation to finish on password page
    await this.delay(2000);

    // Step 4: Detect page state via URL and content
    const currentUrl = this.mailPage.url();
    this.log.info(`🔍 Post-email URL: ${currentUrl}`);

    // Check for "Verify your email" challenge and click "Other ways to sign in" if present
    try {
      const bodyTextPre = await this.mailPage.evaluate(() => document.body?.innerText || '');
      // Some MS pages use id="idA_PWD_SwitchToPassword" or "Other ways to sign in" 
      if (bodyTextPre.includes('Other ways to sign in') || bodyTextPre.includes('Verify your email') || bodyTextPre.includes('password instead')) {
        this.log.info(`⚠️ Microsoft verification challenge detected. Attempting to bypass via "Other ways to sign in" or "Use my password"...`);
        
        let [otherWaysBtn] = await this.mailPage.$$('::-p-xpath(//a[contains(text(), "Other ways to sign in")] | //button[contains(text(), "Other ways to sign in")] | //div[contains(text(), "Other ways to sign in")] | //*[@id="signInAnotherWay"])');
        if (otherWaysBtn) {
          await (otherWaysBtn as any).click();
          await this.delay(1000);
        }
        
        // Wait for "Use my password" or similar option
        let [usePasswordBtn] = await this.mailPage.$$('::-p-xpath(//div[contains(translate(text(), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "password")] | //a[contains(translate(text(), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "password")] | //button[contains(translate(text(), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "password")] | //*[@id="idA_PWD_SwitchToPassword"])');
        if (usePasswordBtn) {
           this.log.info(`🔓 Clicking "Use my password" option...`);
           await (usePasswordBtn as any).click();
           await this.mailPage.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
           await this.delay(1000);
        } else {
           this.log.debug(`⚠️ "Use my password" option not explicitly found, continuing to password check...`);
        }
      }
    } catch (err) {
      this.log.warn(`⚠️ Error checking for 'Other ways to sign in': ${err}`);
    }

    // Step 5: Wait for password field with multiple strategies
    let pwInput = null;
    const pwSelectors = [
      'input[type="password"]',
      'input[name="passwd"]',
      '#i0118',  // Microsoft's password field ID
    ];

    for (const sel of pwSelectors) {
      try {
        pwInput = await this.mailPage.waitForSelector(sel, { timeout: 10000, visible: true });
        if (pwInput) {
          this.log.info(`🔑 Password field found: ${sel}`);
          break;
        }
      } catch { /* try next selector */ }
    }

    if (!pwInput) {
      // Check if we hit a CAPTCHA, error, or different flow
      const bodyText = await this.mailPage.evaluate(() => document.body?.innerText || '');
      if (/captcha|robot|challenge|unusual/i.test(bodyText)) {
        throw new Error('Microsoft login CAPTCHA detected — manual intervention needed');
      }
      if (/doesn.*exist|no.*account|error/i.test(bodyText)) {
        throw new Error('Microsoft account not found or login error');
      }
      throw new Error('Password field not found after all strategies');
    }

    // Step 6: Enter password
    await pwInput.click({ clickCount: 3 });
    await this.delay(200);
    await pwInput.type(this.password, { delay: 25 });
    await this.delay(300);

    // Step 7: Click Sign In with waitForNavigation
    let signInBtn = await this.mailPage.$('#idSIButton9');
    if (!signInBtn) signInBtn = await this.mailPage.$('input[type="submit"]');
    if (!signInBtn) signInBtn = await this.mailPage.$('button[type="submit"]');
    if (!signInBtn) {
      const [xpathBtn] = await this.mailPage.$$('::-p-xpath(//button[contains(text(), "Sign in")] | //input[@value="Sign in"])');
      signInBtn = xpathBtn || null;
    }
    if (!signInBtn) throw new Error('Sign In button not found');

    await Promise.all([
      this.mailPage.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {}),
      signInBtn.click(),
    ]);
    await this.delay(2000);

    // Step 8: Handle post-login pages
    const postLoginUrl = this.mailPage.url();
    this.log.info(`🔍 Post-signin URL: ${postLoginUrl}`);

    // Handle "Stay signed in?" prompt
    try {
      const stayBtn = await this.mailPage.$('#idSIButton9, #idBtn_Back, #acceptButton');
      if (stayBtn) {
        await Promise.all([
          this.mailPage.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {}),
          stayBtn.click(),
        ]);
        await this.delay(1500);
      }
    } catch { /* no stay-signed-in prompt */ }

    // Check for 2FA or additional verification
    const post2faUrl = this.mailPage.url();
    if (/proofs|additional.*security|identity/i.test(post2faUrl)) {
      throw new Error('2FA/additional verification required — manual intervention needed');
    }

    // Step 9: Navigate to inbox
    await this.mailPage.goto('https://outlook.live.com/mail/0/inbox', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await this.delay(3000);
  }

  private async _screenshotOnError(name: string): Promise<void> {
    if (!this.mailPage) return;
    try {
      const path = require('path');
      const os = require('os');
      const screenshotPath = path.join(os.tmpdir(), `nirvana_${name}_${Date.now()}.png`);
      await this.mailPage.screenshot({ path: screenshotPath, fullPage: true });
      this.log.info(`📸 Debug screenshot: ${screenshotPath}`);
    } catch { /* ignore screenshot failures */ }
  }

  private async searchOutlookWeb(targetEmail: string, codePattern: RegExp): Promise<string | null> {
    if (!this.mailPage) return null;

    try {
      // Reload inbox to get latest emails
      await this.mailPage.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
      await this.delay(3000);

      // Get all visible text content from the inbox page
      const pageText: string = await this.mailPage.evaluate(() => {
        return document.body?.innerText || '';
      });

      // Look for Cursor/WorkOS related content
      if (/cursor|workos|verification|verify|code/i.test(pageText)) {
        // Try to match code directly from inbox preview text
        const match = pageText.match(codePattern);
        if (match && match[1]) {
          return match[1];
        }

        // Try clicking on email items to read full body
        const emailItems = await this.mailPage.$$('[role="option"], [data-convid], [aria-label*="cursor" i], [aria-label*="verify" i]');
        for (const item of emailItems.slice(0, 5)) {
          try {
            const itemText: string = await this.mailPage.evaluate((el: any) => el.innerText || '', item);
            if (/cursor|workos|verification|verify|code/i.test(itemText)) {
              await item.click();
              await this.delay(2000);

              const bodyText: string = await this.mailPage.evaluate(() => {
                return document.body?.innerText || '';
              });
              const bodyMatch = bodyText.match(codePattern);
              if (bodyMatch && bodyMatch[1]) {
                return bodyMatch[1];
              }
            }
          } catch { /* skip item */ }
        }
      }
    } catch (err) {
      this.log.warn(`Outlook Web search error: ${err instanceof Error ? err.message : err}`);
    }

    return null;
  }

  async cleanup(): Promise<void> {
    if (this.browser) {
      try { await this.browser.close(); } catch { /* ignore */ }
      this.browser = null;
      this.mailPage = null;
      this.loggedIn = false;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }
}

// ─── Factory ───
export function createEmailService(config: EmailServiceConfig): IEmailService {
  switch (config.type) {
    case 'moemail':
      return new MoeMailService(config.apiUrl);
    case 'duckmail':
      return new DuckMailService();
    case 'cfworker':
      if (!config.apiUrl || !config.apiKey || !config.domain) {
        throw new Error('CF Worker requires apiUrl, apiKey, and domain');
      }
      return new CFWorkerEmailService(config.apiUrl, config.apiKey, config.domain);
    case 'laoudo':
      if (!config.domain) throw new Error('Laoudo requires domain');
      return new LaoudoEmailService(config.domain);
    case 'addyio': {
      const username = config.addyUsername || 'nirvbot';
      const imapCfg = config.imapHost ? {
        host: config.imapHost, port: config.imapPort || 993,
        user: config.imapUser || '', pass: config.imapPass || '',
      } : undefined;
      return new AddyIoService(username, config.apiKey, imapCfg);
    }
    case 'mailtm':
      return new MailTmService();
    case 'imap':
      if (!config.imapUser || !config.imapPass) {
        throw new Error('IMAP alias requires imapUser (email) and imapPass (password/app-password)');
      }
      return new ImapAliasEmailService(config);
    default:
      throw new Error(`Unknown email service type: ${config.type}`);
  }
}

/**
 * All available email service types for UI dropdown
 */
export const EMAIL_SERVICE_OPTIONS: { value: EmailServiceType; label: string; desc: string }[] = [
  { value: 'addyio', label: 'addy.io 无限别名 (推荐)', desc: '免费 Catch-All 子域名，无限邮箱，不需要买域名' },
  { value: 'mailtm', label: 'mail.tm API', desc: '免费临时邮箱，内置验证码读取，无需 IMAP' },
  { value: 'moemail', label: 'MoeMail', desc: '自动注册临时邮箱，无需配置' },
  { value: 'duckmail', label: 'DuckMail', desc: '公共临时邮箱，部分地区需代理' },
  { value: 'cfworker', label: 'Cloudflare Worker', desc: '自建临时邮箱，完全自主可控' },
  { value: 'laoudo', label: 'Laoudo 固定域名', desc: '使用固定域名邮箱，最稳定' },
  { value: 'imap', label: 'IMAP 邮箱', desc: '使用现有邮箱 (Gmail/Outlook 等)' },
];
