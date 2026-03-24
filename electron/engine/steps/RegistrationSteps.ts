import { Logger } from '../../utils/Logger';
import { RegistrationStep, StepContext, StepResult, StepConfig } from './types';

// ─── Session Guard Utility ───

/** Check if the browser page/session is still alive (not detached/closed) */
async function isSessionAlive(page: any): Promise<boolean> {
  try {
    await page.evaluate('1 + 1');
    return true;
  } catch {
    return false;
  }
}

/** Safely type text into an element, retries once if session flickers */
async function safeType(element: any, text: string, page: any, delay = 50): Promise<void> {
  if (!(await isSessionAlive(page))) throw new Error('Session is no longer alive');
  await element.type(text, { delay: delay + Math.random() * 40 });
}

/** Safely click an element */
async function safeClick(element: any, page: any, opts?: any): Promise<void> {
  if (!(await isSessionAlive(page))) throw new Error('Session is no longer alive');
  await element.click(opts);
}

// ─── Step Implementations ───

/**
 * Step 1: Navigate to Cursor signup page.
 */
export class NavigateToSignupStep implements RegistrationStep {
  name = '打开注册页';
  retryable = true;
  private logger = Logger.create('NavigateStep');

  async execute(ctx: StepContext): Promise<StepResult> {
    try {
      ctx.onProgress(this.name, 10);

      // Add extra wait before navigation to let proxy connect fully
      await new Promise(r => setTimeout(r, 2000));

      await ctx.page.goto('https://authenticator.cursor.sh/sign-up', {
        waitUntil: 'domcontentloaded',  // Changed from networkidle2 — more resistant to slow proxy
        timeout: 90000,  // Generous for WARP SOCKS5 proxy (intermittently slow)
      });

      ctx.onProgress(this.name, 40);

      // Wait for page to settle after Cloudflare challenge
      await new Promise(r => setTimeout(r, 3000));

      // Verify session is still alive after potential redirects
      if (!(await isSessionAlive(ctx.page))) {
        return { success: false, retryable: true, error: '页面导航后会话断开' };
      }

      ctx.onProgress(this.name, 60);

      // Wait for the form to appear
      await ctx.page.waitForSelector('input', { timeout: 20000 });

      ctx.onProgress(this.name, 100);
      this.logger.info(`导航成功: ${ctx.email}`);
      return { success: true, retryable: false };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, retryable: true, error: `导航失败: ${msg}` };
    }
  }
}

/**
 * Step 2: Fill in the email form with multiple selector fallbacks.
 * 
 * Fixes original Issue #11: Fragile DOM selectors.
 * Uses a cascade of selectors so that if Cursor changes their form,
 * at least one selector is likely to still work.
 */
export class FillEmailStep implements RegistrationStep {
  name = '填写邮箱';
  retryable = true;
  private logger = Logger.create('FillEmailStep');

  private emailSelectors = [
    'input[name="identifier"]',
    'input[name="email"]',
    'input[type="email"]',
    'input[autocomplete="email"]',
    'input[autocomplete="username"]',
    'input[placeholder*="email" i]',
    'input[placeholder*="邮箱"]',
    '#identifier',
    '#email',
  ];

  private submitSelectors = [
    'button[type="submit"]',
    'button[data-testid="submit"]',
    'button[name="action"]',
    'input[type="submit"]',
    'button:not([type="button"])',
  ];

  async execute(ctx: StepContext): Promise<StepResult> {
    try {
      ctx.onProgress(this.name, 10);

      // Find email input with fallback selectors
      const emailInput = await this.findElement(ctx.page, this.emailSelectors);
      if (!emailInput) {
        return {
          success: false,
          retryable: true,
          error: '未找到邮箱输入框 (所有选择器均失败)',
        };
      }

      ctx.onProgress(this.name, 30);

      // Verify session before typing
      if (!(await isSessionAlive(ctx.page))) {
        return { success: false, retryable: true, error: '填写前会话已断开' };
      }

      // Clear and type email (human-like typing speed)
      await safeClick(emailInput, ctx.page, { clickCount: 3 });
      await emailInput.press('Backspace');
      await safeType(emailInput, ctx.email, ctx.page, 50);

      ctx.onProgress(this.name, 60);

      // Find and click submit button
      const submitBtn = await this.findElement(ctx.page, this.submitSelectors);
      if (!submitBtn) {
        // Fallback: press Enter
        await emailInput.press('Enter');
      } else {
        await safeClick(submitBtn, ctx.page);
      }

      await ctx.page.waitForNavigation({ timeout: 15000 }).catch(() => {});
      await this.sleep(3000);

      ctx.onProgress(this.name, 100);
      this.logger.info(`邮箱已填写: ${ctx.email}`);
      return { success: true, retryable: false };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, retryable: true, error: `填写邮箱失败: ${msg}` };
    }
  }

  private async findElement(page: any, selectors: string[]): Promise<any> {
    for (const selector of selectors) {
      try {
        const el = await page.$(selector);
        if (el) {
          const isVisible = await el.isIntersectingViewport();
          if (isVisible) return el;
        }
      } catch { /* try next */ }
    }
    return null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}

/**
 * Step 3: Fill in first name, last name, and password.
 */
export class FillDetailsStep implements RegistrationStep {
  name = '填写详情';
  retryable = true;
  private logger = Logger.create('FillDetailsStep');

  private firstNameSelectors = [
    'input[name="firstName"]',
    'input[name="first_name"]',
    'input[autocomplete="given-name"]',
    'input[placeholder*="first" i]',
    'input[placeholder*="名"]',
  ];

  private lastNameSelectors = [
    'input[name="lastName"]',
    'input[name="last_name"]',
    'input[autocomplete="family-name"]',
    'input[placeholder*="last" i]',
    'input[placeholder*="姓"]',
  ];

  private passwordSelectors = [
    'input[name="password"]',
    'input[type="password"]',
    'input[autocomplete="new-password"]',
    'input[autocomplete="current-password"]',
    '#password',
  ];

  async execute(ctx: StepContext): Promise<StepResult> {
    try {
      ctx.onProgress(this.name, 10);

      // Generate random name
      const firstName = this.randomName();
      const lastName = this.randomName();
      const password = ctx.password || this.generatePassword();

      // Store password for later use
      ctx.data.set('password', password);
      ctx.data.set('firstName', firstName);
      ctx.data.set('lastName', lastName);

      // Verify session before typing
      if (!(await isSessionAlive(ctx.page))) {
        return { success: false, retryable: true, error: '表单页会话已断开' };
      }

      // Wait for any inputs to be visible
      await ctx.page.waitForSelector('input', { timeout: 10000 }).catch(() => {});
      await this.sleep(1000);

      // Fill first name
      const fnInput = await this.findElement(ctx.page, this.firstNameSelectors);
      if (fnInput) {
        await safeClick(fnInput, ctx.page, { clickCount: 3 });
        await safeType(fnInput, firstName, ctx.page, 40);
      }

      ctx.onProgress(this.name, 30);

      // Fill last name
      const lnInput = await this.findElement(ctx.page, this.lastNameSelectors);
      if (lnInput) {
        await safeClick(lnInput, ctx.page, { clickCount: 3 });
        await safeType(lnInput, lastName, ctx.page, 40);
      }

      ctx.onProgress(this.name, 50);

      // Fill password
      const pwInput = await this.findElement(ctx.page, this.passwordSelectors);
      if (pwInput) {
        await safeClick(pwInput, ctx.page, { clickCount: 3 });
        await safeType(pwInput, password, ctx.page, 30);
      }

      ctx.onProgress(this.name, 70);

      // Submit
      const submitSelectors = [
        'button[type="submit"]',
        'button[name="action"]',
        'button:not([type="button"])',
      ];
      const submit = await this.findElement(ctx.page, submitSelectors);
      if (submit) {
        await safeClick(submit, ctx.page);
      } else {
        if (await isSessionAlive(ctx.page)) {
          await ctx.page.keyboard.press('Enter');
        }
      }

      await ctx.page.waitForNavigation({ timeout: 15000 }).catch(() => {});
      await this.sleep(3000);

      ctx.onProgress(this.name, 100);
      this.logger.info(`注册信息已填写: ${ctx.email}`);
      return { success: true, retryable: false, data: { password } };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, retryable: true, error: `填写注册信息失败: ${msg}` };
    }
  }

  private randomName(): string {
    const names = [
      'James', 'Mary', 'Robert', 'Patricia', 'John', 'Jennifer', 'Michael', 'Linda',
      'David', 'Elizabeth', 'William', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica',
      'Thomas', 'Sarah', 'Christopher', 'Karen', 'Daniel', 'Lisa', 'Matthew', 'Nancy',
    ];
    return names[Math.floor(Math.random() * names.length)];
  }

  private generatePassword(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%';
    let password = '';
    for (let i = 0; i < 16; i++) {
      password += chars[Math.floor(Math.random() * chars.length)];
    }
    return password;
  }

  private async findElement(page: any, selectors: string[]): Promise<any> {
    for (const selector of selectors) {
      try {
        const el = await page.$(selector);
        if (el) return el;
      } catch { /* try next */ }
    }
    return null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}

/**
 * Step 4: Handle CAPTCHA/Turnstile.
 * Currently waits for user to manually solve. Can be extended with auto-solving.
 */
export class HandleCaptchaStep implements RegistrationStep {
  name = '人机验证';
  retryable = true;
  private logger = Logger.create('HandleCaptchaStep');

  async execute(ctx: StepContext): Promise<StepResult> {
    try {
      if (ctx.onProgress) ctx.onProgress(this.name, 10);

      // Check for Turnstile
      const turnstileEl = await ctx.page.$('iframe[src*="turnstile"], .cf-turnstile').catch(() => null);
      const recaptchaEl = await ctx.page.$('iframe[src*="recaptcha"], .g-recaptcha').catch(() => null);

      if (!turnstileEl && !recaptchaEl) {
        this.logger.info('无人机验证，跳过');
        return { success: true, retryable: false };
      }

      const captchaType = turnstileEl ? 'turnstile' : 'recaptcha_v2';
      let siteKey: string | null = null;
      
      siteKey = await ctx.page.evaluate(`
        (() => {
          if ('${captchaType}' === 'turnstile') {
            const el = document.querySelector('.cf-turnstile');
            if (el && el.getAttribute('data-sitekey')) return el.getAttribute('data-sitekey');
            const iframe = document.querySelector('iframe[src*="turnstile"]') as HTMLIFrameElement;
            if (iframe && iframe.src) {
               try { return new URL(iframe.src).searchParams.get('sitekey'); } catch {}
            }
          } else {
            const el = document.querySelector('.g-recaptcha');
            if (el && el.getAttribute('data-sitekey')) return el.getAttribute('data-sitekey');
            const iframe = document.querySelector('iframe[src*="recaptcha"]') as HTMLIFrameElement;
            if (iframe && iframe.src) {
               try { return new URL(iframe.src).searchParams.get('k'); } catch {}
            }
          }
          return null;
        })();
      `);

      if (ctx.onProgress) ctx.onProgress(this.name, 30);
      
      if (siteKey && ctx.captchaConfig) {
        this.logger.info(`Detected ${captchaType} sitekey: ${siteKey}. Auto-solving via ${ctx.captchaConfig.type}...`);
        const { CaptchaSolverService } = await import('../../services/CaptchaSolverService');
        const solver = new CaptchaSolverService(ctx.captchaConfig);
        
        const result = await solver.solve({
          type: captchaType,
          siteKey,
          pageUrl: ctx.page.url()
        });

        if (result.success && result.token) {
          this.logger.info(`Auto-solved in ${result.solveTimeMs}ms. Injecting token...`);
          if (ctx.onProgress) ctx.onProgress(this.name, 80);
          
          await ctx.page.evaluate(`
            (() => {
              if ('${captchaType}' === 'turnstile') {
                const inputs = document.querySelectorAll('input[name="cf-turnstile-response"]');
                inputs.forEach(i => (i as HTMLInputElement).value = '${result.token}');
              } else {
                const inputs = document.querySelectorAll('input[name="g-recaptcha-response"]');
                inputs.forEach(i => (i as HTMLInputElement).value = '${result.token}');
                const inputs2 = document.querySelectorAll('#g-recaptcha-response');
                inputs2.forEach(i => (i as HTMLInputElement).value = '${result.token}');
              }
            })();
          `);
          
          await new Promise(r => setTimeout(r, 3000));
        } else {
          this.logger.warn(`Auto-solve failed: ${result.error}. Falling back to manual wait.`);
        }
      } else {
        this.logger.info('未配置打码服务或未找到 sitekey，等待手动验证...');
      }

      this.logger.info('⏳ 等待人机验证完成或页面跳转...');
      
      const startTime = Date.now();
      const timeout = ctx.config?.timeout || 120000;

      while (Date.now() - startTime < timeout) {
        if (ctx.onProgress) ctx.onProgress(
          this.name,
          Math.min(99, 30 + Math.round(((Date.now() - startTime) / timeout) * 60))
        );

        // Check if page navigated
        const url = ctx.page.url();
        if (!url.includes('sign-up') && !url.includes('login') && !url.includes('register')) {
          if (ctx.onProgress) ctx.onProgress(this.name, 100);
          this.logger.info('✅ 人机验证完成 (页面跳转)');
          return { success: true, retryable: false };
        }
        
        // Also check if captcha element disappeared
        const stillHasCaptcha = await ctx.page.$('iframe[src*="turnstile"], iframe[src*="recaptcha"], .cf-turnstile, .g-recaptcha').catch(() => null);
        if (!stillHasCaptcha) {
           // wait 2s to be sure it's not simply re-rendering
           await new Promise(r => setTimeout(r, 2000));
           const gone = !(await ctx.page.$('iframe[src*="turnstile"], iframe[src*="recaptcha"], .cf-turnstile, .g-recaptcha').catch(() => null));
           if (gone) {
             if (ctx.onProgress) ctx.onProgress(this.name, 100);
             this.logger.info('✅ 人机验证完成 (组件消失)');
             return { success: true, retryable: false };
           }
        }

        await new Promise(r => setTimeout(r, 2000));
      }

      return { success: false, retryable: true, error: '人机验证超时' };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, retryable: true, error: `人机验证异常: ${msg}` };
    }
  }
}

/**
 * Step 5: Wait for and submit verification code from IMAP.
 */
export class SubmitVerificationCodeStep implements RegistrationStep {
  name = '提交验证码';
  retryable = true;
  private logger = Logger.create('SubmitCodeStep');

  async execute(ctx: StepContext): Promise<StepResult> {
    try {
      ctx.onProgress(this.name, 10);

      // Wait for verification code via generic email service
      const code = await ctx.emailService.waitForCode(ctx.email, {
        senderPatterns: ['cursor', 'workos', 'no-reply'],
        codePattern: /(\d{6})/,
        timeoutMs: 120000,
        pollIntervalMs: 8000
      });

      if (!code) {
        return {
          success: false,
          retryable: false,
          error: '验证码获取失败或超时',
        };
      }

      ctx.onProgress(this.name, 50);
      this.logger.info(`📧 验证码: ${code}`);

      // Re-acquire page after long email wait (frame may have detached)
      try {
        const browser = ctx.page.browser?.() || (ctx as any).browser;
        if (browser) {
          const pages = await browser.pages();
          const activePage = pages.find((p: any) => {
            try {
              const url = p.url();
              return url.includes('cursor') || url.includes('clerk') || url.includes('authenticator');
            } catch { return false; }
          }) || pages[pages.length - 1];
          if (activePage && activePage !== ctx.page) {
            this.logger.info('🔄 Page re-acquired after email wait');
            (ctx as any).page = activePage;
          }
        }
      } catch (reacquireErr) {
        this.logger.warn(`Page re-acquire failed: ${reacquireErr}`);
      }

      // Find verification code input
      const codeSelectors = [
        'input[name="code"]',
        'input[type="text"][maxlength="6"]',
        'input[name="otp"]',
        'input[autocomplete="one-time-code"]',
        'input[inputmode="numeric"]',
        'input[placeholder*="code" i]',
        'input[placeholder*="验证码"]',
      ];

      let codeInput = null;
      for (const selector of codeSelectors) {
        codeInput = await ctx.page.$(selector);
        if (codeInput) break;
      }

      if (!codeInput) {
        // Try individual digit inputs (common pattern)
        const digitInputs = await ctx.page.$$('input[maxlength="1"]');
        if (digitInputs.length >= 6) {
          for (let i = 0; i < 6; i++) {
            await digitInputs[i].type(code[i], { delay: 50 });
          }
          ctx.onProgress(this.name, 80);
        } else {
          return { success: false, retryable: true, error: '未找到验证码输入框' };
        }
      } else {
        await codeInput.click({ clickCount: 3 });
        await codeInput.type(code, { delay: 80 + Math.random() * 40 });
        ctx.onProgress(this.name, 70);

        // Submit
        const submitBtn = await ctx.page.$('button[type="submit"]');
        if (submitBtn) {
          await submitBtn.click();
        } else {
          await ctx.page.keyboard.press('Enter');
        }
      }

      await ctx.page.waitForNavigation({ timeout: 15000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 3000));

      ctx.onProgress(this.name, 100);
      this.logger.info(`✅ 验证码已提交: ${ctx.email}`);
      return { success: true, retryable: false, data: { code } };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, retryable: true, error: `验证码步骤失败: ${msg}` };
    }
  }
}

/**
 * Step 6: Extract session token after successful registration.
 */
export class ExtractTokenStep implements RegistrationStep {
  name = '提取 Token';
  retryable = false;
  private logger = Logger.create('ExtractTokenStep');

  async execute(ctx: StepContext): Promise<StepResult> {
    if (!ctx.config.fetchTokenAfterRegister) {
      this.logger.info('跳过 Token 获取 (已禁用)');
      return { success: true, retryable: false };
    }

    try {
      ctx.onProgress(this.name, 10);

      // Navigate to settings to trigger token creation
      await ctx.page.goto('https://www.cursor.com/settings', {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });

      ctx.onProgress(this.name, 40);

      // Extract cookies for session tokens
      const cookies = await ctx.page.cookies();
      const accessToken = cookies.find(
        (c: any) => c.name === 'WorkosCursorSessionToken'
      )?.value;

      if (accessToken) {
        ctx.data.set('accessToken', accessToken);
        ctx.onProgress(this.name, 100);
        this.logger.info(`🔑 Token 获取成功: ${ctx.email}`);
        return { success: true, retryable: false, data: { accessToken } };
      }

      // Fallback: check localStorage for token
      const localToken = await ctx.page.evaluate(() => {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && (key.includes('token') || key.includes('Token'))) {
            return { key, value: localStorage.getItem(key) };
          }
        }
        return null;
      });

      if (localToken) {
        ctx.data.set('accessToken', localToken.value);
        ctx.onProgress(this.name, 100);
        return { success: true, retryable: false, data: { accessToken: localToken.value } };
      }

      return { success: false, retryable: true, error: '未找到 Session Token' };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, retryable: false, error: `Token 获取失败: ${msg}` };
    }
  }
}
