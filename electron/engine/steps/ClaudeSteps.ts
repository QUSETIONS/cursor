import { RegistrationStep, StepContext, StepResult } from './types';
import { Logger } from '../../utils/Logger';
import { SmsService } from '../../services/SmsService';

const logger = Logger.create('ClaudeSteps');
const SMS_ACTIVATE_KEY = process.env.SMS_ACTIVATE_API_KEY || '';

/**
 * 魔法函数：模拟人类真实打字延迟与拼写错误修正机制
 */
async function humanTyping(page: any, selector: string, text: string) {
  const input = await page.waitForSelector(selector);
  for (let i = 0; i < text.length; i++) {
    await input.type(text[i], { delay: Math.random() * 80 + 20 });
    // 2% 几率打错一个字然后退格重打 (DataDome 最喜欢看的回退事件)
    if (Math.random() < 0.02 && i > 0) {
      await input.type('x');
      await page.waitForTimeout(Math.random() * 100 + 50);
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(Math.random() * 50 + 20);
    }
  }
}

/**
 * 魔法函数：生成近似三阶贝塞尔曲线的随机光标轨迹，避免被判定为僵尸直行矢量
 */
async function bezierMouseMove(page: any, targetSelector: string) {
  const element = await page.$(targetSelector);
  if (!element) return;
  const box = await element.boundingBox();
  if (!box) return;

  const targetX = box.x + box.width / 2 + (Math.random() * 10 - 5);
  const targetY = box.y + box.height / 2 + (Math.random() * 10 - 5);

  const startX = Math.random() * 500;
  const startY = Math.random() * 500;
  
  await page.mouse.move(startX, startY);
  
  const steps = 15 + Math.floor(Math.random() * 10);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    // 简易二次贝塞尔缓冲插值方程
    const currX = startX + (targetX - startX) * t + Math.sin(t * Math.PI) * 50; 
    const currY = startY + (targetY - startY) * t + Math.cos(t * Math.PI) * 30;
    await page.mouse.move(currX, currY, { steps: 1 });
    await page.waitForTimeout(Math.random() * 20 + 10);
  }
}

export class ClaudeNavigateStep implements RegistrationStep {
  name = 'Claude_Navigate_DataDome_Bypass';
  retryable = true;
  async execute(ctx: StepContext): Promise<StepResult> {
    ctx.onProgress('切入 Claude.ai，加载防 DataDome 指纹蒙皮...', 10);
    try {
      if (!ctx.page) throw new Error('Browser page not initialized.');
      // 抹除自动化痕迹补充
      await ctx.page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
      });

      await ctx.page.goto('https://claude.ai/login', { waitUntil: 'domcontentloaded', timeout: 45000 });
      // 随机滚动页面以产生人类事件流
      await ctx.page.mouse.wheel({ deltaY: 200 + Math.random() * 200 });
      await ctx.page.waitForTimeout(Math.random() * 2000 + 1000);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: `连通失败或被 DataDome 掐断: ${e.message}`, retryable: true };
    }
  }
}

export class ClaudeFillEmailStep implements RegistrationStep {
  name = 'Claude_FillEmail';
  retryable = false;
  async execute(ctx: StepContext): Promise<StepResult> {
    ctx.onProgress('注入鉴权账户矩阵...', 25);
    try {
      const emailSelector = 'input[type="email"], input[name="email"]';
      await bezierMouseMove(ctx.page, emailSelector);
      await humanTyping(ctx.page, emailSelector, ctx.email);
      
      const btnSelector = 'button[type="submit"], button:has-text("Continue")';
      await bezierMouseMove(ctx.page, btnSelector);
      await ctx.page.click(btnSelector, { delay: Math.random() * 100 + 50 });
      
      await ctx.page.waitForTimeout(3000);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: `登录邮箱注入失败: ${e.message}` };
    }
  }
}

// 注意: 提取登录验证码环节将由统一的 IMAP Step 解决，由于逻辑通用，在此不复述

export class ClaudePhoneVerificationStep implements RegistrationStep {
  name = 'Claude_PhoneVerify_PhysicalSIM';
  retryable = false;
  async execute(ctx: StepContext): Promise<StepResult> {
    if (!SMS_ACTIVATE_KEY) return { success: false, error: 'SMS_ACTIVATE_API_KEY 未配置' };
    
    ctx.onProgress('呼叫美国 T-Mobile 实体手机芯片阵列...', 65);
    const sms = new SmsService(SMS_ACTIVATE_KEY);

    try {
      // 获取 Anthropic 号码 ('ot' 代表 Claude / Anthropic)
      // 注意: Claude 绝杀虚拟号，必须极其限定的高质量实体号国别，187代表美国，可能极其昂贵
      const { id, phone } = await sms.getNumber('ot', 187);
      ctx.data.set('leasedPhone', phone);
      
      ctx.onProgress(`实体卡槽分配完毕: +${phone}，开始过审...`, 70);

      // 输入号码 (加入轨迹模拟)
      const phoneInput = 'input[type="tel"]';
      await bezierMouseMove(ctx.page, phoneInput);
      await humanTyping(ctx.page, phoneInput, phone);
      
      const sendBtn = 'button[type="submit"], button:has-text("Send")';
      await ctx.page.click(sendBtn);

      ctx.onProgress(`监听短信任网 (${id})...`, 80);
      const code = await sms.waitForCode(id, 180); 
      
      if (!code) throw new Error('提取 Claude 短信超时或被封杀, 丢弃号码');
      
      const codeInputSelector = 'input[autocomplete="one-time-code"]';
      await bezierMouseMove(ctx.page, codeInputSelector);
      await humanTyping(ctx.page, codeInputSelector, code);

      await ctx.page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});
      return { success: true };
    } catch (e: any) {
      return { success: false, error: `实体号验证流水线崩溃: ${e.message}` };
    }
  }
}

export class ClaudeExtractSessionStep implements RegistrationStep {
  name = 'Claude_ExtractToken';
  retryable = false;
  async execute(ctx: StepContext): Promise<StepResult> {
    ctx.onProgress('渗透到底层 Cookie 沙盒提取 sessionKey...', 95);
    try {
       await ctx.page.waitForTimeout(4000);
       const cookies = await ctx.page.cookies();
       const sessionKey = cookies.find((c: any) => c.name === 'sessionKey')?.value;
       
       if (sessionKey) {
         ctx.data.set('claudeSession', sessionKey);
         ctx.onProgress('Claude 引擎防屏蔽注册全面胜利 👑', 100);
         return { success: true, data: { sessionKey } };
       }
       return { success: false, error: '未能截获底层的 sessionKey，可能由于触发了二次静默封禁' };
    } catch(e: any) {
       return { success: false, error: `鉴权拦截失败: ${e.message}` };
    }
  }
}
