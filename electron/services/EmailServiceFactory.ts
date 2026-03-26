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

// ─── Direct IMAP Service (Catch-All / Custom Domains) ───
// Reads directly via IMAP protocol without triggering browser-based MS login blocks.
// Perfect for Gmail Catch-All integrations.
class PureImapEmailService implements IEmailService {
  type: EmailServiceType = 'imap';
  displayName = 'Catch-All IMAP 接收器';
  private log = createLogger('PureImap');
  private config: EmailServiceConfig;

  constructor(config: EmailServiceConfig) {
    this.config = config;
    this.log.info(`Pure IMAP service configured: user=${this.config.imapUser}, host=${this.config.imapHost}`);
  }

  async createEmail(prefix?: string): Promise<TempEmail> {
    const catchAllDomain = process.env.CATCH_ALL_DOMAIN || 'nirvana-farm-2026.cyou';
    const slug = prefix || `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const aliasEmail = `${slug}@${catchAllDomain}`;
    this.log.info(`Generated Catch-All alias: ${aliasEmail}`);
    return { address: aliasEmail };
  }

  async waitForCode(email: string, opts?: WaitOptions): Promise<string | null> {
    const options = { ...DEFAULT_WAIT, ...opts };
    this.log.info(`Polling IMAP via ${this.config.imapHost} for code sent to ${email}...`);
    
    try {
      const { ImapService } = require('./ImapService');
      const imapSvc = new ImapService();
      const accountConfig = {
         id: 'dynamic-imap',
         email: this.config.imapUser!,
         password: this.config.imapPass!,
         host: this.config.imapHost || 'imap.gmail.com',
         port: this.config.imapPort || 993,
         tls: true
      };
      
      const result = await imapSvc.fetchVerificationCode(
        accountConfig,
        {
           senderPatterns: options.senderPatterns || ['cursor', 'workos', 'verify', 'noreply'],
           codePattern: options.codePattern || /(\d{6})/,
           targetEmail: email
        },
        true // deleteAfterRead
      );
      
      if (result) {
        this.log.info(`✅ Successfully fetched verification code via IMAP: ${result}`);
        return result;
      }
    } catch(err) {
      this.log.error(`IMAP Polling failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    this.log.warn(`IMAP verification code timeout after ${options.timeoutMs! / 1000}s`);
    return null;
  }

  async cleanup(): Promise<void> {
    // No browser to close in pure IMAP polling
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
      return new PureImapEmailService(config);
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
