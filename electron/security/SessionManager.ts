import { Logger } from '../utils/Logger';

/**
 * Manages admin authentication tokens in the main process ONLY.
 * Tokens never leak to the renderer process.
 * 
 * Fixes original Issue #3: Admin token was passed from frontend JS.
 */
export class SessionManager {
  private logger = Logger.create('SessionManager');
  private adminToken: string | null = null;
  private tokenExpiry: number | null = null;

  /**
   * Set the admin token (called when user logs in).
   */
  login(token: string, expiresInMs: number = 24 * 60 * 60 * 1000): void {
    this.adminToken = token;
    this.tokenExpiry = Date.now() + expiresInMs;
    this.logger.info('Admin session started');
  }

  /**
   * Clear the admin token.
   */
  logout(): void {
    this.adminToken = null;
    this.tokenExpiry = null;
    this.logger.info('Admin session ended');
  }

  /**
   * Check if the admin is authenticated and token is not expired.
   */
  isAuthenticated(): boolean {
    if (!this.adminToken) return false;
    if (this.tokenExpiry && Date.now() > this.tokenExpiry) {
      this.logger.warn('Admin token expired');
      this.logout();
      return false;
    }
    return true;
  }

  /**
   * Get auth headers for API requests (called from main process only).
   */
  getHeaders(): Record<string, string> {
    if (!this.isAuthenticated()) {
      throw new Error('Not authenticated');
    }
    return {
      'X-Admin-Token': this.adminToken!,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Get raw token (for specific cases).
   */
  getToken(): string | null {
    return this.isAuthenticated() ? this.adminToken : null;
  }
}
