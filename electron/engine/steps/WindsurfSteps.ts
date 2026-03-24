import { RegistrationStep, StepContext, StepResult } from './types';
import { Logger } from '../../utils/Logger';

const logger = Logger.create('WindsurfSteps');

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export class WindsurfNavigateStep implements RegistrationStep {
  name = '打开 Windsurf 注册页';
  retryable = true;

  async execute(ctx: StepContext): Promise<StepResult> {
    const page = ctx.page;
    await page.goto('https://codeium.com/account/register', { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('input[name="email"], input[type="email"], #email', { timeout: 15000 });
    return { success: true };
  }
}

export class WindsurfFillEmailStep implements RegistrationStep {
  name = '填写邮箱';
  retryable = true;

  async execute(ctx: StepContext): Promise<StepResult> {
    const page = ctx.page;
    const emailSelectors = ['input[name="email"]', 'input[type="email"]', '#email'];
    
    let filled = false;
    for (const sel of emailSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          await el.click({ clickCount: 3 });
          await el.type(ctx.email, { delay: 30 + Math.random() * 50 });
          filled = true;
          break;
        }
      } catch {}
    }

    if (!filled) return { success: false, error: '未找到邮箱输入框' };

    await sleep(500);

    const submitBtns = ['button[type="submit"]', 'button:has-text("Continue")', 'button:has-text("Next")'];
    for (const sel of submitBtns) {
      try {
        const btn = await page.$(sel);
        if (btn) { await btn.click(); break; }
      } catch {}
    }

    await sleep(3000);
    return { success: true };
  }
}

export class WindsurfFillDetailsStep implements RegistrationStep {
  name = '填写密码';
  retryable = true;

  async execute(ctx: StepContext): Promise<StepResult> {
    const page = ctx.page;
    const password = ctx.password || this.generatePassword();

    const pwSelectors = ['input[type="password"]', 'input[name="password"]', '#password'];
    for (const sel of pwSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          await el.click({ clickCount: 3 });
          await el.type(password, { delay: 30 + Math.random() * 40 });
          break;
        }
      } catch {}
    }

    await sleep(500);
    const nextBtns = ['button:has-text("Sign up")', 'button[type="submit"]'];
    for (const sel of nextBtns) {
      try {
        const btn = await page.$(sel);
        if (btn) { await btn.click(); break; }
      } catch {}
    }

    await sleep(2000);
    return { success: true, data: { password } };
  }

  private generatePassword(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%';
    let p = '';
    for (let i = 0; i < 16; i++) p += chars[Math.floor(Math.random() * chars.length)];
    return p;
  }
}

export class WindsurfCaptchaStep implements RegistrationStep {
  name = '人机验证';
  retryable = true;

  async execute(ctx: StepContext): Promise<StepResult> {
    const page = ctx.page;
    const hasCaptcha = await page.$('iframe[src*="recaptcha"], iframe[src*="turnstile"]').catch(() => null);
    if (!hasCaptcha) return { success: true };

    const maxWait = 120000;
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWait) {
      const stillHasCaptcha = await page.$('iframe[src*="recaptcha"], iframe[src*="turnstile"]').catch(() => null);
      if (!stillHasCaptcha) return { success: true };
      await sleep(2000);
    }
    return { success: false, error: '人机验证超时' };
  }
}

export class WindsurfVerificationStep implements RegistrationStep {
  name = '提交验证码';
  retryable = true;

  async execute(ctx: StepContext): Promise<StepResult> {
    const page = ctx.page;
    const maxWait = 120000;
    const pollInterval = 5000;
    const startTime = Date.now();
    let code: string | null = null;

    while (Date.now() - startTime < maxWait) {
      try {
        code = await this.pollImapForCode(ctx.imapAccounts || [], ctx.email, ctx.config?.deleteMailAfterRead);
        if (code) break;
      } catch {}
      await sleep(pollInterval);
    }

    if (!code) return { success: false, error: '验证码等待超时' };

    const singleInput = await page.$('input[name="code"], input[name="verification_code"], input[type="text"][maxlength="6"]');
    if (singleInput) {
      await singleInput.type(code, { delay: 50 });
    } else {
      const digitInputs = await page.$$('input[maxlength="1"]');
      if (digitInputs.length >= code.length) {
        for (let i = 0; i < code.length; i++) {
          await digitInputs[i].type(code[i], { delay: 80 });
        }
      }
    }

    await sleep(500);
    const verifyBtns = ['button:has-text("Verify")', 'button[type="submit"]'];
    for (const sel of verifyBtns) {
      try {
        const btn = await page.$(sel);
        if (btn) { await btn.click(); break; }
      } catch {}
    }

    await sleep(3000);
    return { success: true, data: { code } };
  }

  private async pollImapForCode(accounts: any[], targetEmail: string, deleteAfterRead?: boolean) {
    const { ImapService } = await import('../../services/ImapService');
    const imap = new ImapService();
    for (const acc of accounts) {
      try {
        const code = await imap.fetchVerificationCode(
          acc,
          { senderPatterns: ['no-reply@codeium.com', 'noreply@codeium.com'], codePattern: /(\d{6})/, targetEmail },
          deleteAfterRead
        );
        if (code) return code;
      } catch {}
    }
    return null;
  }
}

export class WindsurfExtractTokenStep implements RegistrationStep {
  name = '提取 Token';
  retryable = false;

  async execute(ctx: StepContext): Promise<StepResult> {
    const page = ctx.page;
    if (!ctx.config?.fetchTokenAfterRegister) return { success: true, skip: true };

    await sleep(5000);

    const ds = await page.evaluate(() => {
      return localStorage.getItem('supabase.auth.token') || localStorage.getItem('codeium-auth-token');
    });

    if (ds) {
      return { success: true, data: { accessToken: ds } };
    }

    return { success: false, error: '未能提取 Token' };
  }
}
