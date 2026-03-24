import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Logger } from '../utils/Logger';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const KEYTAR_SERVICE = 'nirvana-secure-store';
const KEYTAR_ACCOUNT = 'master-key';

/**
 * Encrypted credential storage.
 * 
 * - Master key stored in OS credential store via keytar
 * - All values encrypted with AES-256-GCM before writing to disk
 * - Each entry has its own IV for security
 * 
 * Fixes original Issue #1: Sensitive data was stored in plain localStorage
 */
export class SecureStorage {
  private logger = Logger.create('SecureStorage');
  private masterKey: Buffer | null = null;
  private storePath: string;
  private data: Record<string, string> = {};

  constructor(userDataPath: string) {
    this.storePath = path.join(userDataPath, 'secure-store.json');
  }

  /**
   * Initialize: load or create master key, load existing store.
   */
  async initialize(): Promise<void> {
    this.masterKey = await this.loadOrCreateMasterKey();
    this.data = this.loadStore();
    this.logger.info(`SecureStorage initialized (${Object.keys(this.data).length} entries)`);
  }

  /**
   * Get a decrypted value.
   */
  async get<T = unknown>(key: string): Promise<T | null> {
    const encrypted = this.data[key];
    if (!encrypted) return null;

    try {
      const decrypted = this.decrypt(encrypted);
      return JSON.parse(decrypted) as T;
    } catch (error) {
      this.logger.error(`Failed to decrypt key "${key}": ${error}`);
      return null;
    }
  }

  /**
   * Set an encrypted value.
   */
  async set(key: string, value: unknown): Promise<void> {
    const json = JSON.stringify(value);
    this.data[key] = this.encrypt(json);
    this.saveStore();
  }

  /**
   * Delete a key.
   */
  async delete(key: string): Promise<void> {
    delete this.data[key];
    this.saveStore();
  }

  /**
   * Check if a key exists.
   */
  has(key: string): boolean {
    return key in this.data;
  }

  /**
   * List all keys (without values).
   */
  keys(): string[] {
    return Object.keys(this.data);
  }

  // ─── Private Methods ───

  private encrypt(plaintext: string): string {
    if (!this.masterKey) throw new Error('SecureStorage not initialized');

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this.masterKey, iv);

    let encrypted = cipher.update(plaintext, 'utf-8', 'base64');
    encrypted += cipher.final('base64');

    const tag = cipher.getAuthTag();

    // Format: iv:tag:ciphertext (all base64)
    return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted}`;
  }

  private decrypt(ciphertext: string): string {
    if (!this.masterKey) throw new Error('SecureStorage not initialized');

    const parts = ciphertext.split(':');
    if (parts.length !== 3) throw new Error('Invalid ciphertext format');

    const iv = Buffer.from(parts[0], 'base64');
    const tag = Buffer.from(parts[1], 'base64');
    const encrypted = parts[2];

    const decipher = crypto.createDecipheriv(ALGORITHM, this.masterKey, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(encrypted, 'base64', 'utf-8');
    decrypted += decipher.final('utf-8');

    return decrypted;
  }

  private async loadOrCreateMasterKey(): Promise<Buffer> {
    try {
      // Try to load keytar dynamically (native module)
      const keytar = await import('keytar');
      const existing = await keytar.getPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT);

      if (existing) {
        this.logger.info('Loaded master key from OS credential store');
        return Buffer.from(existing, 'base64');
      }

      // Generate new master key
      const newKey = crypto.randomBytes(KEY_LENGTH);
      await keytar.setPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT, newKey.toString('base64'));
      this.logger.info('Generated and stored new master key');
      return newKey;
    } catch {
      // Fallback: derive key from machine-specific data
      this.logger.warn('keytar unavailable, using machine-derived key (less secure)');
      const machineId = this.getMachineId();
      return crypto.pbkdf2Sync(machineId, 'nirvana-salt-v3', 100000, KEY_LENGTH, 'sha256');
    }
  }

  private getMachineId(): string {
    const os = require('node:os');
    return `${os.hostname()}-${os.userInfo().username}-${os.cpus()[0]?.model || 'unknown'}`;
  }

  private loadStore(): Record<string, string> {
    try {
      if (fs.existsSync(this.storePath)) {
        const raw = fs.readFileSync(this.storePath, 'utf-8');
        return JSON.parse(raw);
      }
    } catch (error) {
      this.logger.error(`Failed to load store: ${error}`);
    }
    return {};
  }

  private saveStore(): void {
    try {
      const dir = path.dirname(this.storePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      // Write to temp file first, then rename (atomic write)
      const tempPath = this.storePath + '.tmp';
      fs.writeFileSync(tempPath, JSON.stringify(this.data, null, 2), 'utf-8');
      fs.renameSync(tempPath, this.storePath);
    } catch (error) {
      this.logger.error(`Failed to save store: ${error}`);
    }
  }
}
