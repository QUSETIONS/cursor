import { Page } from 'puppeteer-core';
import axios from 'axios';
import { RegistrationStep, StepContext, StepResult } from './types';
import { Logger } from '../../utils/Logger';
import { SmsService } from '../../services/SmsService';

const logger = Logger.create('OpenAISteps');
const FOUNDRY_API = 'http://localhost:8191/v1/solve/arkose';
const SMS_ACTIVATE_KEY = process.env.SMS_ACTIVATE_API_KEY || '';

export class OpenAINavigateStep implements RegistrationStep {
  name = 'OpenAI_Navigate';
  retryable = true;
  async execute(ctx: StepContext): Promise<StepResult> {
    ctx.onProgress('正在建立安全的幽灵隧道...', 5);
    try {
      if (!ctx.page) throw new Error('Browser page not initialized.');
      // 访问 OpenAI 注册入口
      await ctx.page.goto('https://platform.openai.com/signup', { waitUntil: 'domcontentloaded', timeout: 30000 });
      return { success: true };
    } catch (e: any) {
      return { success: false, error: `导航超时: ${e.message}`, retryable: true };
    }
  }
}

export class OpenAIFillCredentialsStep implements RegistrationStep {
  name = 'OpenAI_FillCredentials';
  retryable = false;
  async execute(ctx: StepContext): Promise<StepResult> {
    ctx.onProgress('注入鉴权凭略...', 20);
    const { page, email, password } = ctx;
    try {
      // 模拟拟真输入动作 (防指纹识别)
      const emailInput = await page.waitForSelector('input[type="email"]', { timeout: 15000 });
      await emailInput.type(email, { delay: Math.random() * 50 + 50 });
      
      const btn = await page.$('button[type="submit"], button[data-action="continue"]');
      if (btn) await btn.click();
      
      await page.waitForTimeout(1500);

      const passInput = await page.waitForSelector('input[type="password"]', { timeout: 15000 });
      if (passInput && password) {
        await passInput.type(password, { delay: Math.random() * 50 + 50 });
        const pBtn = await page.$('button[type="submit"], button[data-action="continue"]');
        if (pBtn) await pBtn.click();
      }

      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
      return { success: true };
    } catch (e: any) {
      return { success: false, error: `表单注入失败: ${e.message}` };
    }
  }
}

export class OpenAIArkoseBypassStep implements RegistrationStep {
  name = 'OpenAI_ArkoseBypass';
  retryable = true;
  async execute(ctx: StepContext): Promise<StepResult> {
    ctx.onProgress('分析 Arkose 验证码威胁级别...', 40);
    try {
      // 检测当前是否处于 Arkose 拦截帧中
      const iframe = await ctx.page.frames().find((f: any) => f.url().includes('arkoselabs.com'));
      if (!iframe) {
        logger.info('未发现 Arkose 拦截墙，IP 信誉极佳，直接通行。');
        return { success: true, skip: true };
      }

      logger.warn('遭遇 Arkose 防护墙！移交 The Foundry 铸造厂处理...');
      ctx.onProgress('正在破译 FunCaptcha 协议...', 45);

      const res = await axios.post(FOUNDRY_API, {
        cmd: 'request.get',
        url: ctx.page.url(),
        maxTimeout: 60000,
        proxy: 'http://127.0.0.1:50000'
      });

      if (!res.data?.solution?.token) throw new Error('The Foundry 无法解析当前 Arkose 令牌');
      const arkoseToken = res.data.solution.token;
      
      logger.info('✅ 获取底层 Arkose 凭证成功，正在魔术注入浏览器环境...');
      
      // 伪造并提交 FunCaptcha 环境
      await ctx.page.evaluate((token: string) => {
        const field = document.createElement('input');
        field.type = 'hidden';
        field.name = 'arkose-token';
        field.value = token;
        document.body.appendChild(field);
        
        // 尝试触发内部回调
        if (typeof (window as any).onArkoseComplete === 'function') {
           (window as any).onArkoseComplete(token);
        }
      }, arkoseToken);

      await ctx.page.waitForTimeout(3000);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message, retryable: true };
    }
  }
}

export class OpenAIPhoneVerificationStep implements RegistrationStep {
  name = 'OpenAI_PhoneVerify';
  retryable = false;
  async execute(ctx: StepContext): Promise<StepResult> {
    if (!SMS_ACTIVATE_KEY) return { success: false, error: 'SMS_ACTIVATE_API_KEY 未配置' };
    
    ctx.onProgress('租赁一次性海外物理号码...', 75);
    const sms = new SmsService(SMS_ACTIVATE_KEY);
    const page = ctx.page;

    try {
      // 获取平台号码 ('or' 代表 OpenAI)
      const { id, phone } = await sms.getNumber('or');
      ctx.data.set('leasedPhoneId', id);
      ctx.data.set('leasedPhone', phone);
      
      ctx.onProgress(`号码 [${phone}] 就绪，开始绑定流程...`, 80);

      // 输入号码
      const phoneInput = await page.waitForSelector('input[name="phone_number"]', { timeout: 15000 });
      if (!phoneInput) return { success: false, error: '未找到输入框' };
      
      await phoneInput.type('+' + phone, { delay: 100 });
      const sendBtn = await page.$('button[type="submit"]');
      if (sendBtn) await sendBtn.click();

      // 强等验证码
      ctx.onProgress(`监听短信任网 (${id})...`, 85);
      const code = await sms.waitForCode(id, 180); // 等 3 分钟
      
      if (!code) throw new Error('接收短信超时, 号码已拉黑返还余额');
      
      const codeInputs = await page.$$('input[autocomplete="one-time-code"]');
      if (codeInputs.length > 0) {
        await codeInputs[0].type(code, { delay: 30 });
      }

      await page.waitForNavigation({ waitUntil: 'networkidle2' });
      return { success: true };
    } catch (e: any) {
      return { success: false, error: `手机验证流水线崩溃: ${e.message}` };
    }
  }
}

export class OpenAIExtractSessionStep implements RegistrationStep {
  name = 'OpenAI_ExtractToken';
  retryable = false;
  async execute(ctx: StepContext): Promise<StepResult> {
    ctx.onProgress('提取核心访问互信凭证...', 95);
    try {
       // 等待重定向至 Platform
       await ctx.page.waitForTimeout(3000);
       const cookies = await ctx.page.cookies();
       const sessionToken = cookies.find((c: any) => c.name.startsWith('__Secure-next-auth.session-token'))?.value;
       
       if (sessionToken) {
         ctx.data.set('openaiSession', sessionToken);
         ctx.onProgress('OpenAI 引擎注册圆满毕局', 100);
         return { success: true, data: { sessionToken } };
       }
       return { success: false, error: '未能截获底层的 Session Token' };
    } catch(e: any) {
       return { success: false, error: `鉴权拦截失败: ${e.message}` };
    }
  }
}
