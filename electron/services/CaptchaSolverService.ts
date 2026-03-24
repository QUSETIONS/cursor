/**
 * CaptchaSolverService — Inspired by any-auto-register's captcha integration
 * Supports YesCaptcha, 2Captcha, CapMonster, EZCaptcha, and local Camoufox solver
 */

import { createLogger } from '../utils/Logger';

export type SolverType = 'yescaptcha' | '2captcha' | 'capmonster' | 'ezcaptcha' | 'local';

export interface CaptchaConfig {
  type: SolverType;
  apiKey?: string;
  apiUrl?: string;  // Custom endpoint (for self-hosted)
}

export interface CaptchaTask {
  siteKey: string;
  pageUrl: string;
  type: 'turnstile' | 'recaptcha_v2' | 'recaptcha_v3' | 'hcaptcha';
  action?: string;       // reCAPTCHA v3 action
  data?: string;         // Additional data for Turnstile
  invisible?: boolean;
}

export interface CaptchaResult {
  success: boolean;
  token?: string;
  error?: string;
  solveTimeMs?: number;
}

export class CaptchaSolverService {
  private config: CaptchaConfig;
  private log = createLogger('CaptchaSolver');

  constructor(config: CaptchaConfig) {
    this.config = config;
  }

  /**
   * Solve a captcha challenge
   */
  async solve(task: CaptchaTask): Promise<CaptchaResult> {
    const start = Date.now();
    this.log.info(`Solving ${task.type} via ${this.config.type}...`);

    try {
      switch (this.config.type) {
        case 'yescaptcha':
          return await this.solveViaYesCaptcha(task, start);
        case '2captcha':
          return await this.solveVia2Captcha(task, start);
        case 'capmonster':
          return await this.solveViaCapMonster(task, start);
        case 'ezcaptcha':
          return await this.solveViaEZCaptcha(task, start);
        case 'local':
          return { success: false, error: '本地 solver 需要 Camoufox — 请在浏览器中手动完成' };
        default:
          return { success: false, error: `Unknown solver: ${this.config.type}` };
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        solveTimeMs: Date.now() - start,
      };
    }
  }

  // ─── YesCaptcha ───
  private async solveViaYesCaptcha(task: CaptchaTask, startTime: number): Promise<CaptchaResult> {
    const apiUrl = this.config.apiUrl || 'https://api.yescaptcha.com';

    // Create task
    const createRes = await fetch(`${apiUrl}/createTask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: this.config.apiKey,
        task: this.buildTaskPayload(task, 'yescaptcha'),
      }),
    });
    const createData = await createRes.json() as any;
    if (!createData.taskId) {
      return { success: false, error: createData.errorDescription || '创建任务失败', solveTimeMs: Date.now() - startTime };
    }

    // Poll for result
    return this.pollResult(`${apiUrl}/getTaskResult`, createData.taskId, 'yescaptcha', startTime);
  }

  // ─── 2Captcha ───
  private async solveVia2Captcha(task: CaptchaTask, startTime: number): Promise<CaptchaResult> {
    const apiUrl = this.config.apiUrl || 'https://api.2captcha.com';

    const createRes = await fetch(`${apiUrl}/createTask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: this.config.apiKey,
        task: this.buildTaskPayload(task, '2captcha'),
      }),
    });
    const createData = await createRes.json() as any;
    if (!createData.taskId) {
      return { success: false, error: createData.errorDescription || '创建任务失败', solveTimeMs: Date.now() - startTime };
    }

    return this.pollResult(`${apiUrl}/getTaskResult`, createData.taskId, '2captcha', startTime);
  }

  // ─── CapMonster ───
  private async solveViaCapMonster(task: CaptchaTask, startTime: number): Promise<CaptchaResult> {
    const apiUrl = this.config.apiUrl || 'https://api.capmonster.cloud';

    const createRes = await fetch(`${apiUrl}/createTask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: this.config.apiKey,
        task: this.buildTaskPayload(task, 'capmonster'),
      }),
    });
    const createData = await createRes.json() as any;
    if (!createData.taskId) {
      return { success: false, error: createData.errorDescription || '创建任务失败', solveTimeMs: Date.now() - startTime };
    }

    return this.pollResult(`${apiUrl}/getTaskResult`, createData.taskId, 'capmonster', startTime);
  }

  // ─── EZCaptcha ───
  private async solveViaEZCaptcha(task: CaptchaTask, startTime: number): Promise<CaptchaResult> {
    const apiUrl = this.config.apiUrl || 'https://api.ez-captcha.com';

    const createRes = await fetch(`${apiUrl}/createTask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: this.config.apiKey,
        task: this.buildTaskPayload(task, 'ezcaptcha'),
      }),
    });
    const createData = await createRes.json() as any;
    if (!createData.taskId) {
      return { success: false, error: createData.errorDescription || '创建任务失败', solveTimeMs: Date.now() - startTime };
    }

    return this.pollResult(`${apiUrl}/getTaskResult`, createData.taskId, 'ezcaptcha', startTime);
  }

  // ─── Shared Helpers ───

  private buildTaskPayload(task: CaptchaTask, solver: string): Record<string, any> {
    const base: Record<string, any> = {
      websiteURL: task.pageUrl,
      websiteKey: task.siteKey,
    };

    switch (task.type) {
      case 'turnstile':
        base.type = 'TurnstileTaskProxyless';
        if (task.data) base.metadata = { action: task.action, cdata: task.data };
        break;
      case 'recaptcha_v2':
        base.type = task.invisible ? 'RecaptchaV2TaskProxyless' : 'NoCaptchaTaskProxyless';
        break;
      case 'recaptcha_v3':
        base.type = 'RecaptchaV3TaskProxyless';
        base.minScore = 0.7;
        if (task.action) base.pageAction = task.action;
        break;
      case 'hcaptcha':
        base.type = 'HCaptchaTaskProxyless';
        break;
    }

    return base;
  }

  private async pollResult(url: string, taskId: string, solver: string, startTime: number): Promise<CaptchaResult> {
    const maxWait = 180000; // 3 min max
    const pollInterval = 3000;

    while (Date.now() - startTime < maxWait) {
      await this.delay(pollInterval);

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientKey: this.config.apiKey, taskId }),
      });
      const data = await res.json() as any;

      if (data.status === 'ready') {
        const token = data.solution?.token || data.solution?.gRecaptchaResponse || data.solution?.text;
        this.log.info(`Solved via ${solver} in ${Date.now() - startTime}ms`);
        return {
          success: !!token,
          token,
          solveTimeMs: Date.now() - startTime,
        };
      }

      if (data.errorId && data.errorId !== 0) {
        return { success: false, error: data.errorDescription || '验证码服务报错', solveTimeMs: Date.now() - startTime };
      }
    }

    return { success: false, error: '验证码求解超时 (3min)', solveTimeMs: Date.now() - startTime };
  }

  private delay(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }

  /**
   * Check balance of the solver account
   */
  async getBalance(): Promise<{ balance: number; error?: string }> {
    if (this.config.type === 'local') return { balance: Infinity };

    const urls: Record<string, string> = {
      yescaptcha: 'https://api.yescaptcha.com/getBalance',
      '2captcha': 'https://api.2captcha.com/getBalance',
      capmonster: 'https://api.capmonster.cloud/getBalance',
      ezcaptcha: 'https://api.ez-captcha.com/getBalance',
    };

    try {
      const res = await fetch(urls[this.config.type], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientKey: this.config.apiKey }),
      });
      const data = await res.json() as any;
      return { balance: data.balance || 0 };
    } catch (err) {
      return { balance: 0, error: '余额查询失败' };
    }
  }
}

/** Available solvers for UI dropdown */
export const CAPTCHA_SOLVER_OPTIONS: { value: SolverType; label: string; desc: string }[] = [
  { value: 'yescaptcha', label: 'YesCaptcha', desc: '推荐，支持 Turnstile' },
  { value: '2captcha', label: '2Captcha', desc: '老牌验证码服务' },
  { value: 'capmonster', label: 'CapMonster', desc: 'AntiCaptcha 团队出品' },
  { value: 'ezcaptcha', label: 'EZCaptcha', desc: '性价比高' },
  { value: 'local', label: '本地求解', desc: '使用 Camoufox，无需付费' },
];
