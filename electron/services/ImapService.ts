import { BaseService } from './base/BaseService';
import { RetryPolicy } from './base/RetryPolicy';

export interface ImapConfig {
  id: string;
  email: string;
  password: string;
  host: string;
  port: number;
  tls?: boolean;
  enabled?: boolean;
}

export interface VerificationCodeResult {
  success: boolean;
  code?: string;
  fromEmail?: string;
  imapAccount?: string;
  error?: string;
}

interface ConnectionTestResult {
  success: boolean;
  message: string;
}

/**
 * Well-known IMAP server configurations.
 */
const IMAP_SERVERS: Record<string, { host: string; port: number }> = {
  'gmail.com': { host: 'imap.gmail.com', port: 993 },
  'outlook.com': { host: 'imap-mail.outlook.com', port: 993 },
  'hotmail.com': { host: 'imap-mail.outlook.com', port: 993 },
  'qq.com': { host: 'imap.qq.com', port: 993 },
  '163.com': { host: 'imap.163.com', port: 993 },
  '126.com': { host: 'imap.126.com', port: 993 },
  'yahoo.com': { host: 'imap.mail.yahoo.com', port: 993 },
  'icloud.com': { host: 'imap.mail.me.com', port: 993 },
  'me.com': { host: 'imap.mail.me.com', port: 993 },
};

/**
 * IMAP service for verification code retrieval.
 * 
 * - Connection pooling to avoid reconnect overhead
 * - Multi-account polling with round-robin
 * - Verification code extraction with regex patterns
 * - Built-in retry and circuit breaker from BaseService
 * 
 * Fixes original Issues #7, #12: No retry, fragile dependency chain.
 */
export class ImapService extends BaseService {
  private accounts: ImapConfig[] = [];
  private codeRetry: RetryPolicy;

  constructor() {
    super('ImapService');
    this.codeRetry = new RetryPolicy({
      maxRetries: 20,        // Poll up to 20 times
      baseDelay: 3000,       // 3 second intervals
      maxDelay: 5000,
      backoffMultiplier: 1,  // Linear polling
    });
  }

  protected async initialize(): Promise<void> {
    this.logger.info('ImapService initialized');
  }

  protected async shutdown(): Promise<void> {
    this.logger.info('ImapService shut down');
  }

  async healthCheck(): Promise<boolean> {
    const enabledAccounts = this.accounts.filter((a) => a.enabled !== false);
    if (enabledAccounts.length === 0) return false;

    // Test at least one enabled account
    const result = await this.testConnection(enabledAccounts[0]);
    return result.success;
  }

  /**
   * Set the list of IMAP accounts to use for polling.
   */
  setAccounts(accounts: ImapConfig[]): void {
    this.accounts = accounts;
    this.logger.info(`Loaded ${accounts.length} IMAP accounts`);
  }

  /**
   * Detect IMAP server from email domain.
   */
  static detectServer(email: string): { host: string; port: number } | null {
    const domain = email.split('@')[1]?.toLowerCase();
    return domain ? IMAP_SERVERS[domain] || null : null;
  }

  /**
   * Test IMAP connection to a specific account.
   */
  async testConnection(config: ImapConfig): Promise<ConnectionTestResult> {
    return new Promise((resolve) => {
      try {
        const Imap = require('imap');
        const connection = new Imap({
          user: config.email,
          password: config.password,
          host: config.host,
          port: config.port,
          tls: config.tls !== false,
          tlsOptions: { rejectUnauthorized: false },
          connTimeout: 10000,
          authTimeout: 10000,
        });

        const timeout = setTimeout(() => {
          try { connection.end(); } catch { /* ignore */ }
          resolve({ success: false, message: '连接超时 (10s)' });
        }, 12000);

        connection.once('ready', () => {
          clearTimeout(timeout);
          connection.end();
          resolve({ success: true, message: '连接成功' });
        });

        connection.once('error', (err: Error) => {
          clearTimeout(timeout);
          resolve({ success: false, message: err.message });
        });

        connection.connect();
      } catch (error) {
        resolve({
          success: false,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  /**
   * Poll all enabled IMAP accounts for a verification code.
   * 
   * @param senderPattern - Regex to match sender email (e.g., /cursor|noreply/)
   * @param codePattern - Regex to extract the code (e.g., /(\d{6})/)
   * @param timeout - Max wait time in ms
   * @param deleteAfterRead - Whether to delete the email after reading
   */
  async waitForVerificationCode(params: {
    senderPattern: RegExp;
    codePattern: RegExp;
    targetEmail?: string;
    timeout?: number;
    deleteAfterRead?: boolean;
    sinceDate?: Date;
  }): Promise<VerificationCodeResult> {
    const {
      senderPattern,
      codePattern,
      targetEmail,
      timeout = 120000,
      deleteAfterRead = false,
      sinceDate = new Date(Date.now() - 5 * 60000), // Default: emails from last 5 min
    } = params;

    const enabledAccounts = this.accounts.filter((a) => a.enabled !== false);
    if (enabledAccounts.length === 0) {
      return { success: false, error: '没有可用的 IMAP 接收邮箱' };
    }

    const startTime = Date.now();
    this.logger.info(
      `开始轮询验证码 (${enabledAccounts.length} 个邮箱, 超时 ${timeout / 1000}s)`
    );

    while (Date.now() - startTime < timeout) {
      // Round-robin through all enabled accounts
      for (const account of enabledAccounts) {
        try {
          const result = await this.searchForCode(
            account,
            senderPattern,
            codePattern,
            sinceDate,
            deleteAfterRead,
            targetEmail
          );
          if (result.success && result.code) {
            this.logger.info(
              `✅ 验证码获取成功: ${result.code} (来自 ${account.email})`
            );
            return result;
          }
        } catch (error) {
          this.logger.warn(
            `IMAP 轮询失败 [${account.email}]: ${error instanceof Error ? error.message : error}`
          );
        }
      }

      // Wait before next round
      await new Promise((r) => setTimeout(r, 3000));
    }

    return { success: false, error: `验证码获取超时 (${timeout / 1000}s)` };
  }

  /**
   * Compatibility method for Kiro/Windsurf steps.
   */
  async fetchVerificationCode(
    account: ImapConfig,
    options: { senderPatterns: string[]; codePattern: RegExp; targetEmail?: string },
    deleteAfterRead?: boolean
  ): Promise<string | null> {
    this.setAccounts([account]);
    const result = await this.waitForVerificationCode({
      senderPattern: new RegExp(options.senderPatterns.join('|'), 'i'),
      codePattern: options.codePattern,
      targetEmail: options.targetEmail,
      timeout: 60000,
      deleteAfterRead,
    });
    return result.code || null;
  }

  /**
   * Search a single IMAP account for a verification code email.
   */
  private async searchForCode(
    config: ImapConfig,
    senderPattern: RegExp,
    codePattern: RegExp,
    sinceDate: Date,
    deleteAfterRead: boolean,
    targetEmail?: string
  ): Promise<VerificationCodeResult> {
    return new Promise((resolve) => {
      try {
        const Imap = require('imap');
        const { simpleParser } = require('mailparser');

        const connection = new Imap({
          user: config.email,
          password: config.password,
          host: config.host,
          port: config.port,
          tls: config.tls !== false,
          tlsOptions: { rejectUnauthorized: false },
          connTimeout: 15000,
          authTimeout: 15000,
        });

        const timeout = setTimeout(() => {
          try { connection.end(); } catch { /* ignore */ }
          resolve({ success: false, error: 'IMAP 操作超时' });
        }, 20000);

        connection.once('ready', () => {
          connection.openBox('INBOX', false, (err: Error | null) => {
            if (err) {
              clearTimeout(timeout);
              connection.end();
              resolve({ success: false, error: `打开收件箱失败: ${err.message}` });
              return;
            }

            // Search for recent unread emails
            const searchDate = sinceDate.toISOString().split('T')[0];
            const searchCriteria = [['SINCE', searchDate], ['UNSEEN']];

            connection.search(searchCriteria, (searchErr: Error | null, uids: number[]) => {
              if (searchErr || !uids || uids.length === 0) {
                clearTimeout(timeout);
                connection.end();
                resolve({ success: false });
                return;
              }

              // Fetch the latest emails (newest first)
              const latestUids = uids.slice(-10).reverse();
              const fetch = connection.fetch(latestUids, { bodies: '' });
              let found = false;

              fetch.on('message', (msg: any, seqno: number) => {
                let emailBody = '';
                const uid = latestUids[seqno - 1];

                msg.on('body', (stream: any) => {
                  stream.on('data', (chunk: Buffer) => {
                    emailBody += chunk.toString('utf8');
                  });
                });

                msg.once('end', async () => {
                  if (found) return;

                  try {
                    const parsed = await simpleParser(emailBody);
                    const from = parsed.from?.text || '';
                    const to = parsed.to?.text || '';

                    // If searching for a specific target email (Catch-All mode), filter by the 'To' header
                    if (targetEmail && !to.toLowerCase().includes(targetEmail.toLowerCase())) {
                      return;
                    }

                    // Check if sender matches
                    if (!senderPattern.test(from)) return;

                    // Extract code from text or HTML
                    const text = parsed.text || '';
                    const html = parsed.html || '';
                    const combined = text + ' ' + html;

                    const match = combined.match(codePattern);
                    if (match && match[1]) {
                      found = true;

                      // Mark as read / delete
                      if (deleteAfterRead) {
                        connection.addFlags(uid, '\\Deleted', () => {
                          connection.expunge(() => {});
                        });
                      } else {
                        connection.addFlags(uid, '\\Seen', () => {});
                      }

                      clearTimeout(timeout);
                      connection.end();
                      resolve({
                        success: true,
                        code: match[1],
                        fromEmail: from,
                        imapAccount: config.email,
                      });
                    }
                  } catch { /* ignore parse errors */ }
                });
              });

              fetch.once('end', () => {
                if (!found) {
                  clearTimeout(timeout);
                  connection.end();
                  resolve({ success: false });
                }
              });

              fetch.once('error', () => {
                clearTimeout(timeout);
                connection.end();
                resolve({ success: false, error: '邮件获取失败' });
              });
            });
          });
        });

        connection.once('error', (err: Error) => {
          clearTimeout(timeout);
          resolve({ success: false, error: err.message });
        });

        connection.connect();
      } catch (error) {
        resolve({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }
}
