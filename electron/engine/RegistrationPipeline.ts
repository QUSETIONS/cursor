import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import { Logger } from '../utils/Logger';
import { ProgressTracker } from './ProgressTracker';
import { proxyPool } from '../main';
import type { ProxyEntry } from '../services/ProxyPoolService';
import { ImapService, type ImapConfig } from '../services/ImapService';
import type { IEmailService } from '../services/EmailServiceFactory';
import { BrowserService, type BrowserConfig } from '../services/BrowserService';
import { IPSwitchService, type IPSwitchConfig } from '../services/IPSwitchService';
import {
  NavigateToSignupStep,
  FillEmailStep,
  FillDetailsStep,
  HandleCaptchaStep,
  SubmitVerificationCodeStep,
  ExtractTokenStep,
} from './steps/RegistrationSteps';
import type { RegistrationStep, StepContext, StepConfig } from './steps/types';
import { type Platform, createPipelineSteps } from './PipelineFactory';
import { ConcurrentScheduler } from './ConcurrentScheduler';

export interface RegistrationParams {
  platform?: Platform;
  platformOverride?: string;
  emails: string[];
  imapAccounts: ImapConfig[];
  browserConfig: BrowserConfig;
  ipConfig?: IPSwitchConfig;
  savePath: string;
  interval: number;
  deleteMailAfterRead: boolean;
  fetchTokenAfterRegister: boolean;
  timeout: number;
  captchaConfig?: any;
  concurrency?: number;
  catchAllConfig?: {
    enabled: boolean;
    domain: string;
    imapHost: string;
    imapPort: number;
    imapUser: string;
    imapPass: string;
    imapTls?: boolean;
    targetCount?: number;
  };
  bindCardData?: {
    number: string;
    expMonth: string;
    expYear: string;
    cvc: string;
    name?: string;
    zip?: string;
  };
}

export interface RegistrationResult {
  email: string;
  success: boolean;
  password?: string;
  accessToken?: string;
  error?: string;
}

interface Checkpoint {
  email: string;
  stepIndex: number;
  data: Record<string, unknown>;
  timestamp: number;
}

/**
 * Registration Pipeline Engine
 * 
 * Orchestrates the full registration flow with:
 * - Step-by-step pipeline execution
 * - Checkpoint/resume for failure recovery
 * - Per-step retry with configurable policies
 * - Smart IP switching between registrations
 * - Progress tracking with real-time IPC push
 * - Automatic browser environment cleanup
 * 
 * This is the CORE ENGINE that replaces the monolithic main-C2VrCUTa.js logic.
 */
export class RegistrationPipeline {
  private logger = Logger.create('RegistrationPipeline');
  private progress!: ProgressTracker;
  private browserService: BrowserService;
  private ipService: IPSwitchService;
  private emailService: IEmailService;
  private isRunning = false;
  private shouldStop = false;
  private checkpoints = new Map<string, Checkpoint>();
  private results: RegistrationResult[] = [];
  private window: BrowserWindow | null = null;
  private scheduler?: ConcurrentScheduler;

  constructor(
    browserService: BrowserService,
    ipService: IPSwitchService,
    emailService: IEmailService
  ) {
    this.browserService = browserService;
    this.ipService = ipService;
    this.emailService = emailService;
  }

  setWindow(win: BrowserWindow): void {
    this.window = win;
  }

  /**
   * Execute the full registration pipeline for all emails.
   */
  async execute(params: RegistrationParams): Promise<RegistrationResult[]> {
    if (this.isRunning) throw new Error('注册引擎已在运行中');

    this.isRunning = true;
    this.shouldStop = false;
    this.results = [];
    this.progress = new ProgressTracker(params.emails.length);
    if (this.window) this.progress.setWindow(this.window);

    // Configure services
    this.browserService.setConfig(params.browserConfig);
    if (params.ipConfig) this.ipService.setConfig(params.ipConfig);

    this.logger.info(`🚀 开始批量注册 — 共 ${params.emails.length} 个账号`);

    try {
      this.scheduler = new ConcurrentScheduler({
        maxConcurrent: params.concurrency || 1,
        retryLimit: 0,
        delayBetweenTasksMs: params.interval * 1000,
        delayJitterMs: 1000,
      });

      this.scheduler.on('task-progress', ({ event, task, stats }) => {
        if (event === 'started') this.logger.info(`[${task.email}] 开始执行. (运行中: ${stats.running})`);
        if (event === 'success') this.logger.info(`[${task.email}] 注册成功!`);
        if (event === 'failed') this.logger.warn(`[${task.email}] 注册失败: ${task.error}`);
      });

      this.scheduler.setHandler(async (task) => {
        if (this.shouldStop) {
           return { success: false, error: '用户手动停止注册' };
        }
        
        const email = task.email;
        const resolvedPlatform = (params.platformOverride || params.platform || 'cursor') as Platform;
        const steps = createPipelineSteps(resolvedPlatform);
        
        let proxyUrl: string | undefined;
        let proxyEntry: ProxyEntry | null = null;
        if (params.ipConfig?.strategy === 'proxy') {
          proxyEntry = proxyPool.getStrictRoute();
          if (proxyEntry) {
            const auth = proxyEntry.username ? `${proxyEntry.username}:${proxyEntry.password || ''}@` : '';
            proxyUrl = `${proxyEntry.protocol}://${auth}${proxyEntry.host}:${proxyEntry.port}`;
            this.logger.info(`[${email}] 获取到专属隔离代理: ${proxyEntry.host}:${proxyEntry.port}`);
          } else {
            this.logger.warn(`[${email}] 无法获取到代理，将使用默认网络`);
          }
        }

        const result = await this.registerSingleAccount(email, params, steps, proxyUrl);
        
        if (proxyEntry) {
          proxyPool.releaseRoute(proxyEntry.id);
        }

        this.results.push(result);
        
        this.saveResult(result, params.savePath);

        // Smart IP switching (thread-safe handled at network level, though multiple concurrent might trigger simultaneously 
        // which might cause contention, IPSwitchService should ideally lock. Assumed mostly safe for simple proxies)
        if (params.ipConfig?.strategy && params.ipConfig.strategy !== 'system' && params.ipConfig.strategy !== 'proxy') {
          const eventRes = result.success ? 'success' : 'fail';
          if (this.ipService.shouldSwitch(eventRes)) {
            this.progress.setStep(email, '🔄 切换 IP/代理...', 0);
            const switchResult = await this.ipService.switchIP();
            if (switchResult.success) {
              this.logger.info(`IP: ${switchResult.previousIP} → ${switchResult.newIP}`);
            }
          }
        }
        return { success: result.success, result, error: result.error };
      });

      const validEmails = params.emails
        .map(e => e.trim())
        .filter(e => e && e.includes('@'))
        .map(e => ({ platform: (params.platformOverride || params.platform || 'cursor') as string, email: e }));
      
      this.scheduler.addTasks(validEmails);
      await this.scheduler.start();

    } finally {
      this.isRunning = false;
      this.scheduler = undefined;
    }

    this.logger.info(
      `🏁 注册完成 — 成功: ${this.results.filter((r) => r.success).length}, ` +
        `失败: ${this.results.filter((r) => !r.success).length}`
    );

    return this.results;
  }

  /**
   * Stop the registration pipeline.
   */
  stop(): void {
    this.shouldStop = true;
    this.logger.info('收到停止信号');
    if (this.scheduler) {
      this.scheduler.stop();
    }
  }

  /**
   * Check if pipeline is running.
   */
  get running(): boolean {
    return this.isRunning;
  }

  /**
   * Register a single account through all pipeline steps.
   */
  private async registerSingleAccount(
    email: string,
    params: RegistrationParams,
    steps: RegistrationStep[],
    proxyUrl?: string
  ): Promise<RegistrationResult> {
    let envId: string | null = null;
    let browser: any = null;

    try {
      // Step 0: Create browser environment
      this.progress.setStep(email, '🌐 创建浏览器环境', 0);
      const overrideConfig = proxyUrl ? { proxyUrl } : undefined;
      const env = await this.browserService.createEnvironment(overrideConfig);
      envId = env.id;

      // Connect via puppeteer-extra with stealth
      const puppeteer = require('puppeteer-extra');
      const StealthPlugin = require('puppeteer-extra-plugin-stealth');
      puppeteer.use(StealthPlugin());

      browser = await puppeteer.connect({
        browserWSEndpoint: env.wsEndpoint,
        defaultViewport: null,
      });

      const page = await browser.newPage();

      // Set a realistic viewport
      await page.setViewport({ width: 1280, height: 800 });

      // Create step context
      const stepConfig: StepConfig = {
        deleteMailAfterRead: params.deleteMailAfterRead,
        fetchTokenAfterRegister: params.fetchTokenAfterRegister,
        timeout: params.timeout,
        bindCardData: params.bindCardData,
      };

      const context: StepContext = {
        email,
        browser,
        page,
        emailService: this.emailService,
        config: stepConfig,
        data: new Map(),
        captchaConfig: params.captchaConfig,
        onProgress: (step, progress) => {
          this.progress.setStep(email, step, progress);
        },
      };

      // Check for checkpoint (resume from failure)
      const checkpoint = this.checkpoints.get(email);
      const startStep = checkpoint ? checkpoint.stepIndex : 0;
      if (checkpoint) {
        // Restore checkpoint data
        for (const [k, v] of Object.entries(checkpoint.data)) {
          context.data.set(k, v);
        }
        this.logger.info(`♻️ 从检查点恢复: ${email} (步骤 ${startStep})`);
      }

      // Execute pipeline steps
      for (let si = startStep; si < steps.length; si++) {
        if (this.shouldStop) {
          // Save checkpoint for potential resume
          this.saveCheckpoint(email, si, context.data);
          return { email, success: false, error: '用户停止' };
        }

        const step: RegistrationStep = steps[si];
        this.progress.setStep(email, `${step.name}...`, 0);

        // ★ Re-acquire the active page before each step to handle frame detach
        try {
          const pages = await browser.pages();
          const activePage = pages.length > 0 ? pages[pages.length - 1] : null;
          if (activePage) {
            context.page = activePage;
            // Verify the new page is alive
            await activePage.evaluate('1').catch(() => {});
          }
        } catch { /* keep existing page reference */ }

        const result = await step.execute(context);

        if (!result.success) {
          // Retry once if retryable
          if (result.retryable) {
            this.logger.warn(`↩️ 重试步骤: ${step.name}`);
            await this.sleep(2000);
            const retryResult = await step.execute(context);
            if (!retryResult.success) {
              this.saveCheckpoint(email, si, context.data);
              this.progress.recordFailure(email, step.name, retryResult.error || '未知错误', true);
              return { email, success: false, error: retryResult.error };
            }
          } else {
            this.progress.recordFailure(email, step.name, result.error || '未知错误', false);
            return { email, success: false, error: result.error };
          }
        }
      }

      // Registration successful
      const password = context.data.get('password') as string || '';
      const accessToken = context.data.get('accessToken') as string || '';

      this.progress.recordSuccess(email);
      // Clear checkpoint on success
      this.checkpoints.delete(email);

      return { email, success: true, password, accessToken };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.progress.recordFailure(email, '系统异常', msg, true);
      return { email, success: false, error: msg };
    } finally {
      // ★ ALWAYS clean up browser environment
      if (browser) {
        try { await browser.disconnect(); } catch { /* ignore */ }
      }
      if (envId) {
        try { await this.browserService.destroyEnvironment(envId); } catch { /* ignore */ }
      }
    }
  }

  /**
   * Save checkpoint for resume-on-failure.
   */
  private saveCheckpoint(email: string, stepIndex: number, data: Map<string, unknown>): void {
    const checkpoint: Checkpoint = {
      email,
      stepIndex,
      data: Object.fromEntries(data),
      timestamp: Date.now(),
    };
    this.checkpoints.set(email, checkpoint);
    this.logger.info(`💾 检查点保存: ${email} @ 步骤 ${stepIndex}`);
  }

  /**
   * Save registration result to file immediately (crash-safe).
   */
  private saveResult(result: RegistrationResult, savePath: string): void {
    try {
      if (!fs.existsSync(savePath)) {
        fs.mkdirSync(savePath, { recursive: true });
      }

      const date = new Date().toISOString().split('T')[0];
      const filePath = path.join(savePath, `accounts_${date}.txt`);

      let line: string;
      if (result.success) {
        const parts = [
          result.email,
          result.password || '',
          result.accessToken || '',
        ];
        line = parts.join('----');
      } else {
        line = `# FAILED: ${result.email} — ${result.error}`;
      }

      fs.appendFileSync(filePath, line + '\n', 'utf-8');
      this.logger.debug(`结果已保存: ${filePath}`);
    } catch (error) {
      this.logger.error(`保存结果失败: ${error}`);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
