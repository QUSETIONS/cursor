/**
 * AccountPoolService — Manages the inventory of registered accounts across all platforms
 * Supports CRUD, filtering, batch operations, and export/import
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import { createLogger } from '../utils/Logger';

export type Platform = 'cursor' | 'kiro' | 'windsurf' | 'warp';
export type AccountStatus = 'active' | 'expired' | 'suspended' | 'unverified';

export interface PoolAccount {
  id: string;
  platform: Platform;
  email: string;
  password: string;
  token?: string;        // accessToken / API Key
  refreshToken?: string;
  apiKey?: string;        // Windsurf Codeium API Key
  status: AccountStatus;
  plan?: string;          // free / pro / team
  createdAt: string;
  lastUsedAt?: string;
  expiresAt?: string;
  metadata?: Record<string, any>;
}

export interface PoolStats {
  total: number;
  byPlatform: Record<Platform, number>;
  byStatus: Record<AccountStatus, number>;
  activeRate: number;
}

export interface PoolFilter {
  platform?: Platform;
  status?: AccountStatus;
  search?: string;        // email keyword
  sortBy?: 'createdAt' | 'lastUsedAt' | 'email';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export class AccountPoolService {
  private db!: Database.Database;
  private dataDir: string;
  private log = createLogger('AccountPool');

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  async initialize(): Promise<void> {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    
    const dbPath = path.join(this.dataDir, 'account_pool.db');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');

    // Schema Migrations using PRAGMA user_version
    const versionRow = this.db.pragma('user_version', { simple: true }) as number;
    let currentVersion = versionRow || 0;

    if (currentVersion === 0) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS accounts (
          id TEXT PRIMARY KEY,
          platform TEXT NOT NULL,
          email TEXT NOT NULL,
          password TEXT NOT NULL,
          token TEXT,
          refreshToken TEXT,
          apiKey TEXT,
          status TEXT NOT NULL,
          plan TEXT,
          createdAt TEXT NOT NULL,
          lastUsedAt TEXT,
          expiresAt TEXT,
          metadata TEXT
        );
        PRAGMA user_version = 1;
      `);
      this.log.info('Migrated database schema to v1');
      currentVersion = 1;
    } 
    
    // Future v2 migrations hook here:
    // if (currentVersion === 1) { ... }

    // Migrate from JSON if it exists
    this.migrateFromJSON();

    const row = this.db.prepare('SELECT COUNT(*) as count FROM accounts').get() as { count: number };
    this.log.info(`Account pool (SQLite) loaded: ${row.count} accounts`);
  }

  // ─── CRUD ───

  addAccount(account: Omit<PoolAccount, 'id'>): PoolAccount {
    const id = `${account.platform}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const full: PoolAccount = { ...account, id };
    
    this.insertAccount(full);
    this.log.info(`Added ${account.platform} account: ${account.email}`);
    return full;
  }

  getAccount(id: string): PoolAccount | undefined {
    const row = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as any;
    return row ? this.mapRow(row) : undefined;
  }

  updateAccount(id: string, updates: Partial<PoolAccount>): boolean {
    const keys = Object.keys(updates).filter(k => k !== 'id');
    if (keys.length === 0) return false;

    const setStr = keys.map(k => `${k} = ?`).join(', ');
    const values = keys.map(k => {
      const v = (updates as any)[k];
      return (typeof v === 'object' && v !== null) ? JSON.stringify(v) : v;
    });

    const stmt = this.db.prepare(`UPDATE accounts SET ${setStr} WHERE id = ?`);
    const info = stmt.run(...values, id);
    return info.changes > 0;
  }

  removeAccount(id: string): boolean {
    const info = this.db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
    return info.changes > 0;
  }

  // ─── Query ───

  list(filter?: PoolFilter): PoolAccount[] {
    let sql = 'SELECT * FROM accounts WHERE 1=1';
    const params: any[] = [];

    if (filter?.platform) {
      sql += ' AND platform = ?';
      params.push(filter.platform);
    }
    if (filter?.status) {
      sql += ' AND status = ?';
      params.push(filter.status);
    }
    if (filter?.search) {
      sql += ' AND email LIKE ?';
      params.push(`%${filter.search}%`);
    }

    const validSortCols = ['createdAt', 'lastUsedAt', 'email'];
    const sortBy = filter?.sortBy && validSortCols.includes(filter.sortBy) ? filter.sortBy : 'createdAt';
    const sortOrder = filter?.sortOrder === 'asc' ? 'ASC' : 'DESC';
    
    sql += ` ORDER BY ${sortBy} ${sortOrder}`;

    if (filter?.limit) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
      
      if (filter.offset) {
        sql += ' OFFSET ?';
        params.push(filter.offset);
      }
    }

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(r => this.mapRow(r));
  }

  getStats(): PoolStats {
    const byPlatformRows = this.db.prepare('SELECT platform, COUNT(*) as c FROM accounts GROUP BY platform').all() as any[];
    const byStatusRows = this.db.prepare('SELECT status, COUNT(*) as c FROM accounts GROUP BY status').all() as any[];
    const totalRow = this.db.prepare('SELECT COUNT(*) as c FROM accounts').get() as { c: number };

    const byPlatform: Record<Platform, number> = { cursor: 0, kiro: 0, windsurf: 0, warp: 0 };
    const byStatus: Record<AccountStatus, number> = { active: 0, expired: 0, suspended: 0, unverified: 0 };

    byPlatformRows.forEach(r => { byPlatform[r.platform as Platform] = r.c; });
    byStatusRows.forEach(r => { byStatus[r.status as AccountStatus] = r.c; });

    const total = totalRow.c;

    return {
      total,
      byPlatform,
      byStatus,
      activeRate: total > 0 ? byStatus.active / total : 0,
    };
  }

  // ─── Batch Operations ───

  /**
   * Pull an available account from the pool (marks as used)
   */
  pullAccount(platform: Platform, plan?: string): PoolAccount | null {
    const sql = plan 
      ? 'SELECT * FROM accounts WHERE platform = ? AND status = ? AND plan = ? ORDER BY RANDOM() LIMIT 1'
      : 'SELECT * FROM accounts WHERE platform = ? AND status = ? ORDER BY RANDOM() LIMIT 1';
      
    const params = plan ? [platform, 'active', plan] : [platform, 'active'];
    
    const row = this.db.prepare(sql).get(...params) as any;
    if (!row) return null;

    const account = this.mapRow(row);
    const now = new Date().toISOString();
    this.updateAccount(account.id, { lastUsedAt: now });
    account.lastUsedAt = now;
    
    return account;
  }

  /**
   * Batch import from file (format: email----password----token----refreshToken)
   */
  importFromFile(filePath: string, platform: Platform): { imported: number; skipped: number } {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));

    let imported = 0;
    let skipped = 0;

    for (const line of lines) {
      const parts = line.trim().split('----');
      if (parts.length < 2) { skipped++; continue; }

      const [email, password, token, refreshToken] = parts;

      // Dedup check in SQLite
      const existing = this.db.prepare('SELECT id FROM accounts WHERE email = ? AND platform = ?').get(email, platform);
      if (existing) { skipped++; continue; }

      this.addAccount({
        platform,
        email: email.trim(),
        password: password.trim(),
        token: token?.trim() || undefined,
        refreshToken: refreshToken?.trim() || undefined,
        status: 'active',
        createdAt: new Date().toISOString(),
      });
      imported++;
    }

    this.log.info(`Imported ${imported} accounts (${skipped} skipped) for ${platform}`);
    return { imported, skipped };
  }

  /**
   * Export accounts to file
   */
  exportToFile(filePath: string, filter?: PoolFilter): number {
    const accounts = this.list(filter);
    const lines = accounts.map(a => {
      const parts = [a.email, a.password, a.token || '', a.refreshToken || ''];
      return parts.join('----');
    });

    fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
    this.log.info(`Exported ${lines.length} accounts to ${filePath}`);
    return lines.length;
  }

  /**
   * Batch verify accounts (check status)
   */
  async batchUpdateStatus(ids: string[], status: AccountStatus): Promise<number> {
    let updated = 0;
    for (const id of ids) {
      if (this.updateAccount(id, { status })) updated++;
    }
    return updated;
  }

  /**
   * Sync accounts from RegPlatform
   */
  async syncRegPlatform(url: string, token: string, platform: string = 'cursor'): Promise<{ imported: number, error?: string }> {
    try {
      this.log.info(`Syncing from RegPlatform: ${url}`);
      let normalizedUrl = url.endsWith('/') ? url.slice(0, -1) : url;
      
      const res = await fetch(`${normalizedUrl}/api/results?platform=${platform}&page_size=-1`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`Fetch failed: ${res.statusText}`);
      const data = await res.json();
      
      const items = data.items || [];
      if (items.length === 0) return { imported: 0 };

      let imported = 0;
      for (const item of items) {
        if (item.disabled) continue; 
        
        let password = '';
        let accToken = '';
        
        try {
          const creds = typeof item.credential_data === 'string' 
            ? JSON.parse(item.credential_data) 
            : (item.credential_data || {});

          password = creds.password || '';
          accToken = creds.access_token || ''; 
        } catch(e) {}

        const mappedToken = item.auth_token || accToken;
        const existing = this.db.prepare('SELECT id FROM accounts WHERE email = ? AND platform = ?').get(item.email, item.platform);
        if (existing) continue;

        this.addAccount({
          platform: item.platform as Platform,
          email: item.email,
          password: password,
          token: mappedToken,
          status: 'active',
          createdAt: new Date().toISOString()
        });
        imported++;
      }

      // Archive them on RegPlatform so we don't fetch them again
      if (items.length > 0) {
        try {
           await fetch(`${normalizedUrl}/api/results/archive`, {
             method: 'POST',
             headers: { 
               'Authorization': `Bearer ${token}`,
               'Content-Type': 'application/json'
             },
             body: JSON.stringify({ platform })
           });
        } catch(e) {
           this.log.error('Failed to archive on RegPlatform:', e);
        }
      }

      this.log.info(`Imported ${imported} accounts from ${items.length} RegPlatform results`);
      return { imported };
    } catch (e: any) {
      this.log.error('RegPlatform sync error:', e);
      return { imported: 0, error: e.message };
    }
  }

  // ─── Persistence ───

  // ─── Persistence Helpers ───
  
  private insertAccount(full: PoolAccount) {
    const stmt = this.db.prepare(`
      INSERT INTO accounts (
        id, platform, email, password, token, refreshToken, apiKey, status, plan, createdAt, lastUsedAt, expiresAt, metadata
      ) VALUES (
        @id, @platform, @email, @password, @token, @refreshToken, @apiKey, @status, @plan, @createdAt, @lastUsedAt, @expiresAt, @metadata
      )
    `);
    
    stmt.run({
      ...full,
      token: full.token || null,
      refreshToken: full.refreshToken || null,
      apiKey: full.apiKey || null,
      plan: full.plan || null,
      lastUsedAt: full.lastUsedAt || null,
      expiresAt: full.expiresAt || null,
      metadata: full.metadata ? JSON.stringify(full.metadata) : null,
    });
  }

  private mapRow(row: any): PoolAccount {
    const acc: PoolAccount = {
      id: row.id,
      platform: row.platform,
      email: row.email,
      password: row.password,
      status: row.status,
      createdAt: row.createdAt
    };
    if (row.token) acc.token = row.token;
    if (row.refreshToken) acc.refreshToken = row.refreshToken;
    if (row.apiKey) acc.apiKey = row.apiKey;
    if (row.plan) acc.plan = row.plan;
    if (row.lastUsedAt) acc.lastUsedAt = row.lastUsedAt;
    if (row.expiresAt) acc.expiresAt = row.expiresAt;
    if (row.metadata) {
      try { acc.metadata = JSON.parse(row.metadata); } catch(e) {}
    }
    return acc;
  }

  private migrateFromJSON(): void {
    const jsonFile = path.join(this.dataDir, 'account_pool.json');
    if (!fs.existsSync(jsonFile)) return;

    try {
      const data = JSON.parse(fs.readFileSync(jsonFile, 'utf-8'));
      if (Array.isArray(data)) {
        this.log.info(`Migrating ${data.length} accounts from JSON...`);
        const insertMany = this.db.transaction((accounts) => {
          for (const a of accounts) {
            const existing = this.db.prepare('SELECT id FROM accounts WHERE id = ?').get(a.id);
            if (!existing) {
              this.insertAccount(a);
            }
          }
        });
        insertMany(data);
        fs.renameSync(jsonFile, jsonFile + '.bak');
        this.log.info('JSON migration completed.');
      }
    } catch (err) {
      this.log.error('Failed to migrate from JSON:', err);
    }
  }
}
