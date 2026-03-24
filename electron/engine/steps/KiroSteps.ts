import { RegistrationStep, StepContext, StepResult } from './types';
import { Logger } from '../../utils/Logger';

const logger = Logger.create('KiroSteps');

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ─── Kiro Step 1: Navigate to AWS Builder ID Signup ───
export class KiroNavigateStep implements RegistrationStep {
  name = '打开 Kiro 注册页';
  retryable = true;

  async execute(ctx: StepContext): Promise<StepResult> {
    const page = ctx.page;
    await page.goto('https://kiro.dev', { waitUntil: 'networkidle2', timeout: 30000 });

    const selectors = [
      'a[href*="authorize"]',
      'button:has-text("Sign")',
      'a:has-text("Get Started")',
      '[data-testid="sign-in"]',
      'a[href*="login"]',
      'a[href*="signup"]',
    ];

    let clicked = false;
    for (const sel of selectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          await el.click();
          clicked = true;
          break;
        }
      } catch { /* try next */ }
    }

    if (!clicked) {
      await page.goto('https://authorize.kiro.dev', { waitUntil: 'networkidle2', timeout: 30000 });
    }

    await page.waitForSelector('input[type="email"], input[name="email"], #email', { timeout: 15000 });
    return { success: true };
  }
}

// ─── Kiro Step 2: Create AWS Builder ID (Email) ───
export class KiroFillEmailStep implements RegistrationStep {
  name = '填写邮箱';
  retryable = true;

  async execute(ctx: StepContext): Promise<StepResult> {
    const page = ctx.page;
    const emailSelectors = [
      '#email',
      'input[name="email"]',
      'input[type="email"]',
      'input[autocomplete="email"]',
      'input[placeholder*="email" i]',
      'input[placeholder*="邮箱"]',
      'input[aria-label*="email" i]',
    ];

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
      } catch { /* try next */ }
    }

    if (!filled) return { success: false, error: '未找到邮箱输入框' };

    await sleep(500);

    const createBtnSelectors = [
      'button:has-text("Create")',
      'button:has-text("Next")',
      'button[type="submit"]',
      'input[type="submit"]',
      '[data-testid="create-account"]',
      'button:has-text("继续")',
    ];

    for (const sel of createBtnSelectors) {
      try {
        const btn = await page.$(sel);
        if (btn) { await btn.click(); break; }
      } catch { /* try next */ }
    }

    await sleep(3000);
    return { success: true };
  }
}

// ─── Kiro Step 3: Fill Name ───
export class KiroFillNameStep implements RegistrationStep {
  name = '填写姓名';
  retryable = true;

  async execute(ctx: StepContext): Promise<StepResult> {
    const page = ctx.page;
    const firstName = ctx.firstName || this.randomName();
    const lastName = ctx.lastName || this.randomName();

    const nameSelectors = [
      '#name',
      'input[name="name"]',
      'input[name="givenName"]',
      'input[placeholder*="name" i]',
    ];

    for (const sel of nameSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          await el.click({ clickCount: 3 });
          await el.type(`${firstName} ${lastName}`, { delay: 30 + Math.random() * 40 });
          break;
        }
      } catch { /* try next */ }
    }

    await sleep(500);
    const nextBtns = ['button:has-text("Next")', 'button[type="submit"]', 'button:has-text("Continue")'];
    for (const sel of nextBtns) {
      try {
        const btn = await page.$(sel);
        if (btn) { await btn.click(); break; }
      } catch { /* next */ }
    }

    await sleep(2000);
    return { success: true, data: { firstName, lastName } };
  }

  private randomName(): string {
    const names = ['James', 'Mary', 'John', 'Patricia', 'Robert', 'Jennifer', 'Michael', 'Linda', 'David', 'Elizabeth'];
    return names[Math.floor(Math.random() * names.length)];
  }
}

// ─── Kiro Step 4: Submit Email Verification Code ───
export class KiroVerificationStep implements RegistrationStep {
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
      } catch { /* retry */ }
      await sleep(pollInterval);
    }

    if (!code) return { success: false, error: '验证码等待超时 (120s)' };

    const singleInput = await page.$('input[name="confirmationCode"], input[name="code"], input[name="otp"]');
    if (singleInput) {
      await singleInput.click({ clickCount: 3 });
      await singleInput.type(code, { delay: 50 });
    } else {
      const digitInputs = await page.$$('input[maxlength="1"]');
      if (digitInputs.length >= code.length) {
        for (let i = 0; i < code.length; i++) {
          await digitInputs[i].type(code[i], { delay: 80 });
        }
      } else {
        return { success: false, error: '未找到验证码输入框' };
      }
    }

    await sleep(500);
    const verifyBtns = ['button:has-text("Verify")', 'button:has-text("Confirm")', 'button[type="submit"]'];
    for (const sel of verifyBtns) {
      try {
        const btn = await page.$(sel);
        if (btn) { await btn.click(); break; }
      } catch { /* next */ }
    }

    await sleep(3000);
    return { success: true, data: { code } };
  }

  private async pollImapForCode(
    accounts: any[],
    targetEmail: string,
    deleteAfterRead?: boolean
  ): Promise<string | null> {
    const { ImapService } = await import('../../services/ImapService');
    const imap = new ImapService();
    for (const acc of accounts) {
      try {
        const code = await imap.fetchVerificationCode(
          acc,
          { senderPatterns: ['no-reply@signin.aws', 'no-reply@login.awsapps.com', 'noreply@amazon.com', 'noreply@kiro.dev'], codePattern: /(\d{6})/, targetEmail },
          deleteAfterRead
        );
        if (code) return code;
      } catch { /* try next account */ }
    }
    return null;
  }
}

// ─── Kiro Step 5: Authorize Kiro Access ───
export class KiroAuthorizeStep implements RegistrationStep {
  name = '授权 Kiro 访问';
  retryable = true;

  async execute(ctx: StepContext): Promise<StepResult> {
    const page = ctx.page;
    await sleep(2000);

    const allowBtns = [
      'button:has-text("Allow")',
      'button:has-text("Approve")',
      'button:has-text("Allow access")',
      'button:has-text("授权")',
      'input[type="submit"][value*="Allow"]',
    ];

    for (const sel of allowBtns) {
      try {
        const btn = await page.$(sel);
        if (btn) {
          await btn.click();
          break;
        }
      } catch { /* next */ }
    }

    await sleep(5000);
    return { success: true };
  }
}

// ─── Kiro Step 6: Extract Token ───
export class KiroExtractTokenStep implements RegistrationStep {
  name = '提取 Token';
  retryable = false;

  async execute(ctx: StepContext): Promise<StepResult> {
    const page = ctx.page;
    if (!ctx.config?.fetchTokenAfterRegister) return { success: true, skip: true };

    await sleep(5000);

    const cookies = await page.cookies();
    const tokenCookie = cookies.find((c: any) =>
      c.name.includes('token') || c.name.includes('session') || c.name.includes('auth')
    );

    const localStorageToken = await page.evaluate(() => {
      const keys = ['accessToken', 'refreshToken', 'id_token', 'access_token', 'authToken'];
      const result: Record<string, string> = {};
      for (const key of keys) {
        const val = localStorage.getItem(key);
        if (val) result[key] = val;
      }
      return Object.keys(result).length > 0 ? result : null;
    });

    const tokenData: Record<string, any> = {};
    if (tokenCookie) tokenData.cookieToken = tokenCookie.value;
    if (localStorageToken) Object.assign(tokenData, localStorageToken);

    return {
      success: Object.keys(tokenData).length > 0,
      data: tokenData,
      error: Object.keys(tokenData).length === 0 ? '未能提取 Token' : undefined,
    };
  }
}

// ─── Kiro Step 7: Automatic Stripe VCC Binding ───
export class KiroBindCardStep implements RegistrationStep {
  name = '绑定虚拟信用卡 (Stripe)';
  retryable = true;

  async execute(ctx: StepContext): Promise<StepResult> {
    const page = ctx.page;
    if (!ctx.config?.bindCardData) return { success: true, skip: true };

    logger.info('Attempting to bind VCC via Stripe Elements...');
    await sleep(2000);

    const vccData = ctx.config.bindCardData;
    let bound = false;

    // Retry finding the iframe a few times
    for (let attempts = 0; attempts < 5; attempts++) {
      for (const frame of page.frames()) {
        const url = frame.url();
        if (url.includes('js.stripe.com') || url.includes('checkout.stripe.com')) {
          try {
            const cardInput = await frame.$('input[name="cardnumber"]');
            if (cardInput) {
              logger.info('Located Stripe secure iframe. Typing card number...');
              await cardInput.click({ clickCount: 3 });
              await cardInput.type(vccData.number, { delay: 60 });

              const expInput = await frame.$('input[name="exp-date"]');
              if (expInput) {
                await expInput.type(`${vccData.expMonth}${vccData.expYear}`, { delay: 60 });
              }

              const cvcInput = await frame.$('input[name="cvc"]');
              if (cvcInput) {
                await cvcInput.type(vccData.cvc, { delay: 60 });
              }

              const zipInput = await frame.$('input[name="postal"]');
              if (zipInput && vccData.zip) {
                await zipInput.type(vccData.zip, { delay: 60 });
              }
              
              bound = true;
              break;
            }
          } catch (e) {
             logger.debug('Frame element search error', e);
          }
        }
      }
      if (bound) break;
      await sleep(2000);
    }

    if (!bound) {
      return { success: false, error: '未能定位 Stripe 支付 IFrame' };
    }
    
    // Submit payment
    const submitBtns = [
      'button:has-text("Subscribe")',
      'button:has-text("Save Card")',
      'button:has-text("Submit")',
      'button[type="submit"]'
    ];
    for (const sel of submitBtns) {
      try {
        const btn = await page.$(sel);
        if (btn && await btn.isVisible()) {
          await btn.click();
          logger.info('Clicked Stripe submit button');
          break;
        }
      } catch { /* next */ }
    }

    await sleep(5000);
    return { success: true, data: { bound: true, last4: vccData.number.slice(-4) } };
  }
}

