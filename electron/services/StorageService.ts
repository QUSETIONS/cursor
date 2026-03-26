import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { Logger } from '../utils/Logger';

const log = Logger.create('StorageService');

export interface RegistrationRecord {
  platform: string;
  email: string;
  password?: string;
  token?: string;
  proxyIp: string;
  timestamp: number;
  status: 'success' | 'failed';
  errorReason?: string;
}

export class StorageService {
  private static get dataDir(): string {
    // In dev mode, use project root. In packaged mode, use app.getPath('userData')
    const isDev = process.env.NODE_ENV === 'development' || !app?.isPackaged;
    const dir = isDev ? path.join(process.cwd(), 'data') : path.join(app.getPath('userData'), 'data');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  private static get accountsFile(): string {
    return path.join(this.dataDir, 'accounts.json');
  }

  private static get proxyScoresFile(): string {
    return path.join(this.dataDir, 'proxy_scores.json');
  }

  // ─── Accounts ───

  public static saveAccount(record: RegistrationRecord): void {
    try {
      const accounts = this.getAllAccounts();
      accounts.push(record);
      fs.writeFileSync(this.accountsFile, JSON.stringify(accounts, null, 2));
      log.info(`Saved account record: ${record.email} (${record.platform})`);
    } catch (err: any) {
      log.error(`Failed to save account: ${err.message}`);
    }
  }

  public static getAllAccounts(): RegistrationRecord[] {
    try {
      if (!fs.existsSync(this.accountsFile)) return [];
      const content = fs.readFileSync(this.accountsFile, 'utf-8');
      return JSON.parse(content) || [];
    } catch {
      return [];
    }
  }

  // ─── Proxy Scores ───

  public static saveProxyScores(scores: Record<string, number>): void {
    try {
      fs.writeFileSync(this.proxyScoresFile, JSON.stringify(scores, null, 2));
    } catch (err: any) {
      log.error(`Failed to save proxy scores: ${err.message}`);
    }
  }

  public static loadProxyScores(): Record<string, number> {
    try {
      if (!fs.existsSync(this.proxyScoresFile)) return {};
      const content = fs.readFileSync(this.proxyScoresFile, 'utf-8');
      return JSON.parse(content) || {};
    } catch {
      return {};
    }
  }
}
