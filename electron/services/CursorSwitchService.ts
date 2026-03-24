import { BaseService } from './base/BaseService';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';

const execAsync = promisify(exec);

export class CursorSwitchService extends BaseService {
  private cursorAppDataPath: string;

  constructor() {
    super('CursorSwitchService');
    // Determine Cursor AppData path (Windows currently heavily favored)
    if (process.platform === 'win32') {
      this.cursorAppDataPath = path.join(process.env.APPDATA || '', 'Cursor', 'User', 'globalStorage');
    } else if (process.platform === 'darwin') {
      this.cursorAppDataPath = path.join(os.homedir(), 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage');
    } else {
      this.cursorAppDataPath = path.join(os.homedir(), '.config', 'Cursor', 'User', 'globalStorage');
    }
  }

  protected async initialize(): Promise<void> {
    this.logger.info(`CursorSwitchService initialized. Path: ${this.cursorAppDataPath}`);
  }

  protected async shutdown(): Promise<void> {
    // No specific shutdown cleanup needed
  }

  async healthCheck(): Promise<boolean> {
    return fs.existsSync(this.cursorAppDataPath);
  }

  /**
   * Kills the Cursor IDE process
   */
  private async killCursorProcess(): Promise<void> {
    try {
      if (process.platform === 'win32') {
        await execAsync('taskkill /F /IM Cursor.exe').catch(() => {});
      } else if (process.platform === 'darwin') {
        await execAsync('pkill -9 Cursor').catch(() => {});
      } else {
        await execAsync('killall -9 cursor').catch(() => {});
      }
      this.logger.info('已关闭 Cursor 进程');
      // Wait a moment for file locks to release
      await new Promise((r) => setTimeout(r, 1000));
    } catch (err) {
      this.logger.warn(`关闭 Cursor 进程失败 (可能未在运行): ${err}`);
    }
  }

  /**
   * Resets the hardware identity tracked by Cursor
   */
  private resetMachineIds(): boolean {
    const storageJsonPath = path.join(this.cursorAppDataPath, 'storage.json');
    if (!fs.existsSync(storageJsonPath)) {
      this.logger.warn(`storage.json not found at ${storageJsonPath}`);
      return false;
    }

    try {
      const data = fs.readFileSync(storageJsonPath, 'utf8');
      const storage = JSON.parse(data);

      const generateMacMachineId = () => crypto.randomBytes(32).toString('hex');
      const generateMachineId = () => crypto.randomBytes(32).toString('hex');
      const generateSqmId = () => `{${crypto.randomUUID().toUpperCase()}}`;
      const generateDevDeviceId = () => crypto.randomUUID();

      storage['telemetry.macMachineId'] = generateMacMachineId();
      storage['telemetry.machineId'] = generateMachineId();
      storage['telemetry.sqmId'] = generateSqmId();
      storage['telemetry.devDeviceId'] = generateDevDeviceId();

      // Ensure write success with formatting
      fs.writeFileSync(storageJsonPath, JSON.stringify(storage, null, 2), 'utf8');
      this.logger.info('成功随机化 storage.json 中的机器特征码');
      return true;
    } catch (err) {
      this.logger.error(`Resetting machine IDs failed: ${err}`);
      return false;
    }
  }

  /**
   * Injects the provided token into Cursor's SQLite state database
   */
  private injectToken(token: string): boolean {
    const dbPath = path.join(this.cursorAppDataPath, 'state.vscdb');
    if (!fs.existsSync(dbPath)) {
      this.logger.warn(`state.vscdb not found at ${dbPath}`);
      return false;
    }

    let db: Database.Database | null = null;
    try {
      // Connect to SQLite DB with a 5000ms busy timeout to prevent SQLITE_BUSY crashes if Cursor isn't fully killed
      db = new Database(dbPath, { timeout: 5000 });
      
      const setOrUpdate = (key: string, value: string) => {
        const row = db!.prepare('SELECT [key] FROM ItemTable WHERE [key] = ?').get(key);
        if (row) {
          db!.prepare('UPDATE ItemTable SET [value] = ? WHERE [key] = ?').run(value, key);
        } else {
          db!.prepare('INSERT INTO ItemTable ([key], [value]) VALUES (?, ?)').run(key, value);
        }
      };

      // Set the standard access token keys utilized by Cursor Auth
      const splitToken = token.includes('%3A%3A') ? token : `Nirvana-Injected::${token}`;
      setOrUpdate('cursorAuth/accessToken', token);
      setOrUpdate('cursorAuth/cachedSignUpType', 'Auth_0'); 
      setOrUpdate('cursorAuth/cachedEmail', 'auto-inject@nirvana.test');

      this.logger.info('成功向 state.vscdb 注入全新访问令牌');
      return true;
    } catch (err) {
      this.logger.error(`Injecting token failed: ${err}`);
      return false;
    } finally {
      if (db) {
        try {
          db.close();
        } catch (e) { /* ignore */ }
      }
    }
  }

  /**
   * Orchestrates the entire identity switch and token swap.
   * If a targetToken is provided, it replaces the session. 
   */
  async switchAccountAndIdentity(targetToken?: string): Promise<{ success: boolean; message: string }> {
    return this.withResilience(async () => {
      this.logger.info(`开始一键无缝换号流程... ${targetToken ? '(带有Token注入)' : '(仅随机机器码)'}`);
      
      // 1. Kill process
      await this.killCursorProcess();

      // 2. Wipe identity
      const idReset = this.resetMachineIds();
      if (!idReset) throw new Error('Failed to reset Machine IDs in storage.json');

      // 3. Inject new token if supplied
      if (targetToken) {
        const tokenInjected = this.injectToken(targetToken);
        if (!tokenInjected) {
          this.logger.warn('Token injection failed, you might need to login manually the first time.');
        }
      }

      // 4. Optionally restart Cursor automatically
      try {
        if (process.platform === 'win32') {
          // Fire and forget Cursor launch
          const cursorExe = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'cursor', 'Cursor.exe');
          if (fs.existsSync(cursorExe)) {
            exec(`start "" "${cursorExe}"`);
            this.logger.info('已请求重启 Cursor.exe');
          }
        }
      } catch (err) {
        this.logger.warn(`重启 Cursor 失败: ${err}`);
      }

      return { success: true, message: 'Cursor 环境和身份已成功重置' };
    }, 'switchCursorIdentity');
  }
}
