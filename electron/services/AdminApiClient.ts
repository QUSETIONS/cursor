/**
 * AdminApiClient — Secure API client for communicating with the Nirvana admin backend
 * Implements request signing, anti-replay, and automatic token refresh
 */

import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import * as crypto from 'node:crypto';
import { createLogger } from '../utils/Logger';
import { SessionManager } from '../security/SessionManager';

export interface AdminConfig {
  baseURL: string;
  timeout?: number;
  signKey?: string; // HMAC key for request signing
}

export interface PullAccountResult {
  success: boolean;
  data?: {
    account: { email: string; password: string; account_type: string; codeium_api_key?: string };
    lock_token: string;
    is_subscription_pull: boolean;
  };
  message?: string;
  wait_seconds?: number;
}

export interface PoolStockResult {
  success: boolean;
  data?: Record<string, Record<string, number>>; // { windsurf: { FREE: 10, PRO: 5 }, ... }
}

export interface UserInfo {
  user_id: number;
  username: string;
  email: string;
  points_normal: number;
  points_trial: number;
  is_banned: boolean;
  membership?: { status: string; plan_level: string; plan_type: string; end_at: string };
}

export class AdminApiClient {
  private client: AxiosInstance;
  private sessionManager: SessionManager;
  private log = createLogger('AdminAPI');

  constructor(config: AdminConfig, sessionManager: SessionManager) {
    this.sessionManager = sessionManager;

    this.client = axios.create({
      baseURL: config.baseURL,
      timeout: config.timeout || 15000,
      headers: { 'Content-Type': 'application/json' },
    });

    // ─── Request Interceptor: Sign + Authenticate ───
    this.client.interceptors.request.use((req) => {
      const token = this.sessionManager.getToken();
      if (token) {
        req.headers['Authorization'] = `Bearer ${token}`;
      }

      // Anti-replay: timestamp + nonce
      const timestamp = Date.now().toString();
      const nonce = crypto.randomBytes(8).toString('hex');
      req.headers['X-Timestamp'] = timestamp;
      req.headers['X-Nonce'] = nonce;

      // HMAC signature if key is configured
      if (config.signKey) {
        const payload = `${req.method?.toUpperCase()}:${req.url}:${timestamp}:${nonce}`;
        const signature = crypto.createHmac('sha256', config.signKey).update(payload).digest('hex');
        req.headers['X-Signature'] = signature;
      }

      return req;
    });

    // ─── Response Interceptor: Handle errors ───
    this.client.interceptors.response.use(
      (res) => res,
      (err) => {
        if (err.response?.status === 401) {
          this.log.warn('Session expired — clearing token');
          this.sessionManager.logout();
        }
        return Promise.reject(err);
      }
    );
  }

  // ─── Auth ───

  async login(username: string, password: string): Promise<{ success: boolean; message?: string }> {
    try {
      const res = await this.client.post('/auth/login', { username, password });
      if (res.data.success && res.data.token) {
        this.sessionManager.login(res.data.token);
        return { success: true };
      }
      return { success: false, message: res.data.message || '登录失败' };
    } catch (err) {
      return { success: false, message: this.extractError(err) };
    }
  }

  async logout(): Promise<void> {
    this.sessionManager.logout();
  }

  // ─── Account Pool API ───

  async pullAccount(poolType: string, accountType: string, usePoints: boolean = true): Promise<PullAccountResult> {
    try {
      const res = await this.client.post('/pool/pull', {
        pool_type: poolType,
        account_type: accountType,
        use_points: usePoints,
      });
      return res.data;
    } catch (err) {
      return { success: false, message: this.extractError(err) };
    }
  }

  async confirmPull(poolType: string, lockToken: string, isSubscription: boolean): Promise<{ success: boolean; message?: string }> {
    try {
      const res = await this.client.post('/pool/confirm', {
        pool_type: poolType,
        lock_token: lockToken,
        is_subscription_pull: isSubscription,
      });
      return res.data;
    } catch (err) {
      return { success: false, message: this.extractError(err) };
    }
  }

  async cancelPull(poolType: string, lockToken: string, reason: string): Promise<{ success: boolean }> {
    try {
      const res = await this.client.post('/pool/cancel', {
        pool_type: poolType,
        lock_token: lockToken,
        reason,
      });
      return res.data;
    } catch (err) {
      return { success: false };
    }
  }

  async getPoolStock(): Promise<PoolStockResult> {
    try {
      const res = await this.client.get('/pool/stock');
      return res.data;
    } catch (err) {
      return { success: false };
    }
  }

  // ─── User Management ───

  async getUserInfo(): Promise<{ success: boolean; data?: UserInfo }> {
    try {
      const res = await this.client.get('/user/me');
      return res.data;
    } catch (err) {
      return { success: false };
    }
  }

  async getUserPoints(): Promise<{ points_normal: number; points_trial: number } | null> {
    try {
      const res = await this.client.get('/user/points');
      return res.data.success ? res.data : null;
    } catch {
      return null;
    }
  }

  // ─── Admin APIs ───

  async getAdminStats(): Promise<any> {
    try {
      const res = await this.client.get('/admin/stats');
      return res.data;
    } catch (err) {
      return { success: false, message: this.extractError(err) };
    }
  }

  async getPoolConfigs(): Promise<any> {
    try {
      const res = await this.client.get('/admin/module-configs');
      return res.data;
    } catch {
      return { success: false };
    }
  }

  async getPricing(): Promise<any> {
    try {
      const res = await this.client.get('/admin/pricing');
      return res.data;
    } catch {
      return { success: false };
    }
  }

  // ─── Helpers ───

  private extractError(err: any): string {
    if (err.response?.data?.message) return err.response.data.message;
    if (err.message) return err.message;
    return '网络错误';
  }
}
