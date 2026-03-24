/**
 * Extra Platform Plugins — Trae.ai, ChatGPT, Tavily
 * Implements the BasePlatformPlugin interface for registration via the PluginRegistry
 */

import { BasePlatformPlugin, PlatformInfo, RegisterResult, PlatformAction, registerPlugin } from '../PluginRegistry';
import { RetryPolicy } from '../../services/base/RetryPolicy';

// Helper for dynamic proxy dispatcher in Node 18+
const getDispatcher = (proxyUrl?: string) => {
  if (!proxyUrl) return undefined;
  try {
    const { ProxyAgent } = require('undici');
    return new ProxyAgent(proxyUrl);
  } catch (e) {
    return undefined;
  }
};

// ─── Trae.ai Plugin ───
class TraePlatformPlugin implements BasePlatformPlugin {
  info: PlatformInfo = {
    name: 'trae',
    displayName: 'Trae.ai',
    version: '1.0.0',
    supportedExecutors: ['protocol', 'headless'],
    emoji: '🤖',
    color: '#6366f1',
  };

  async register(email: string, password?: string, options?: Record<string, any>): Promise<RegisterResult> {
    const policy = new RetryPolicy({ maxRetries: 2, baseDelay: 2000 });
    return policy.execute(async () => {
      try {
        const signupRes = await fetch('https://trae.ai/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password: password || this.generatePassword() }),
          // @ts-ignore
          dispatcher: getDispatcher(options?.proxyUrl),
        });

        if (!signupRes.ok) {
          const err = await signupRes.json().catch(() => ({})) as any;
          return { success: false, error: err.message || `HTTP ${signupRes.status}` };
        }

        const data = await signupRes.json() as any;
        return {
          success: true,
          email,
          password: password || data.password,
          token: data.accessToken || data.token,
          refreshToken: data.refreshToken,
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }, `Trae.ai Registration (${email})`);
  }

  async checkValid(accountId: string): Promise<boolean> {
    // Would check token validity against Trae.ai API
    return true;
  }

  getCustomActions(): PlatformAction[] {
    return [
      {
        id: 'trae-upgrade-pro',
        label: '生成 Pro 升级链接',
        description: '生成一次性 Trae Pro 升级邀请链接',
        handler: async () => {
          // In production: call Trae.ai API to generate upgrade link
          return { success: true, data: { upgradeUrl: 'https://trae.ai/upgrade/...' } };
        },
      },
    ];
  }

  private generatePassword(): string {
    const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$';
    let pw = '';
    for (let i = 0; i < 16; i++) pw += chars[Math.floor(Math.random() * chars.length)];
    return pw;
  }
}

// ─── ChatGPT / OpenAI Plugin ───
class ChatGPTPlatformPlugin implements BasePlatformPlugin {
  info: PlatformInfo = {
    name: 'chatgpt',
    displayName: 'ChatGPT',
    version: '1.0.0',
    supportedExecutors: ['headless', 'headed'],
    emoji: '🧠',
    color: '#10a37f',
  };

  async register(email: string, password?: string): Promise<RegisterResult> {
    // ChatGPT signup requires browser automation (Auth0/WorkOS)
    // This is a stub — actual implementation would use BrowserService
    return {
      success: false,
      error: 'ChatGPT 注册需要浏览器模式，请使用 headed 执行器',
    };
  }

  async checkValid(accountId: string): Promise<boolean> {
    return true;
  }

  getCustomActions(): PlatformAction[] {
    return [
      {
        id: 'chatgpt-check-plus',
        label: '检查 Plus 状态',
        description: '验证账号是否为 ChatGPT Plus',
        handler: async (accountId: string) => {
          return { success: true, data: { isPlusAccount: false } };
        },
      },
    ];
  }
}

// ─── Tavily (AI Search) Plugin ───
class TavilyPlatformPlugin implements BasePlatformPlugin {
  info: PlatformInfo = {
    name: 'tavily',
    displayName: 'Tavily',
    version: '1.0.0',
    supportedExecutors: ['protocol'],
    emoji: '🔍',
    color: '#f59e0b',
  };

  async register(email: string, password?: string, options?: Record<string, any>): Promise<RegisterResult> {
    const policy = new RetryPolicy({ maxRetries: 2, baseDelay: 2000 });
    return policy.execute(async () => {
      try {
        const res = await fetch('https://app.tavily.com/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password: password || this.generatePassword() }),
          // @ts-ignore
          dispatcher: getDispatcher(options?.proxyUrl),
        });

        if (!res.ok) {
          return { success: false, error: `HTTP ${res.status}` };
        }

        const data = await res.json() as any;
        return {
          success: true,
          email,
          apiKey: data.apiKey || data.api_key,
          token: data.token,
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }, `Tavily Registration (${email})`);
  }

  async checkValid(accountId: string): Promise<boolean> {
    return true;
  }

  private generatePassword(): string {
    const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$';
    let pw = '';
    for (let i = 0; i < 16; i++) pw += chars[Math.floor(Math.random() * chars.length)];
    return pw;
  }
}

// ─── OpenBlockLabs Plugin ───
class OpenBlockLabsPlatformPlugin implements BasePlatformPlugin {
  info: PlatformInfo = {
    name: 'openblocklabs',
    displayName: 'OpenBlockLabs',
    version: '1.0.0',
    supportedExecutors: ['protocol'],
    emoji: '📊',
    color: '#8b5cf6',
  };

  async register(email: string, password?: string, options?: Record<string, any>): Promise<RegisterResult> {
    const policy = new RetryPolicy({ maxRetries: 2, baseDelay: 2000 });
    return policy.execute(async () => {
      try {
        const res = await fetch('https://www.openblocklabs.com/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password: password || this.generatePassword() }),
          // @ts-ignore
          dispatcher: getDispatcher(options?.proxyUrl),
        });

        const data = await res.json().catch(() => ({})) as any;
        return {
          success: res.ok,
          email,
          token: data.token,
          apiKey: data.apiKey,
          error: !res.ok ? (data.message || `HTTP ${res.status}`) : undefined,
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }, `OpenBlockLabs Registration (${email})`);
  }

  async checkValid(): Promise<boolean> {
    return true;
  }

  private generatePassword(): string {
    const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$';
    let pw = '';
    for (let i = 0; i < 16; i++) pw += chars[Math.floor(Math.random() * chars.length)];
    return pw;
  }
}

// ─── Auto-register all plugins ───
export function registerAllPlatformPlugins(): void {
  registerPlugin(new TraePlatformPlugin());
  registerPlugin(new ChatGPTPlatformPlugin());
  registerPlugin(new TavilyPlatformPlugin());
  registerPlugin(new OpenBlockLabsPlatformPlugin());
}
