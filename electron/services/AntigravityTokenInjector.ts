import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Logger } from '../utils/Logger';

const logger = Logger.create('AntigravityTokenInjector');

export interface IOAuthPayload {
  access_token: string;
  refresh_token: string;
  scope: string;
  token_type: string;
  id_token: string;
  expiry_date: number;
}

/**
 * Service to inject the generated Google OAuth tokens straight into the 
 * Antigravity CLI context folder (~/.gemini) so the agent gains immediate
 * operational access.
 */
export class AntigravityTokenInjector {
  private geminiDir: string;
  
  constructor() {
    this.geminiDir = path.join(os.homedir(), '.gemini');
  }

  /**
   * Directly writes the given oauth payload to ~/.gemini/oauth_creds.json
   */
  public injectOAuthCredentials(payload: IOAuthPayload): void {
    if (!fs.existsSync(this.geminiDir)) {
      fs.mkdirSync(this.geminiDir, { recursive: true });
    }

    const credsPath = path.join(this.geminiDir, 'oauth_creds.json');
    fs.writeFileSync(credsPath, JSON.stringify(payload, null, 2), 'utf-8');
    logger.info(`✅ Successfully overwrote Antigravity OAuth credentials at ${credsPath}`);
  }

  /**
   * Updates ~/.gemini/google_accounts.json with a new active email, pushing
   * the old one to the 'old' array.
   */
  public rotateGoogleAccount(newEmail: string): void {
    const accPath = path.join(this.geminiDir, 'google_accounts.json');
    let accounts: { active: string; old: string[] } = { active: '', old: [] };

    if (fs.existsSync(accPath)) {
      try {
        const raw = fs.readFileSync(accPath, 'utf-8');
        accounts = JSON.parse(raw);
      } catch (e) {
        logger.warn('Failed to parse existing google_accounts.json, creating new one.');
      }
    }

    if (accounts.active && accounts.active !== newEmail) {
      if (!accounts.old.includes(accounts.active)) {
        accounts.old.push(accounts.active);
      }
    }
    accounts.active = newEmail;

    fs.writeFileSync(accPath, JSON.stringify(accounts, null, 2), 'utf-8');
    logger.info(`✅ Successfully rotated Antigravity Google account to ${newEmail}`);
  }
}
