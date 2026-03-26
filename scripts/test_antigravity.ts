import fs from 'node:fs';
import path from 'node:path';
import * as dotenv from 'dotenv';
dotenv.config();

// Since we're bypassing UI, we can instantiate the pipeline directly or just run a puppeteer script similar to run_registration_pro.ts
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { AntigravityTokenInjector } from '../electron/services/AntigravityTokenInjector';
import { AntigravityNavigateSignupStep, AntigravityFillDetailsStep, AntigravitySelectEmailStep, AntigravityPhoneVerificationStep, AntigravityOAuthConsentStep } from '../electron/engine/steps/AntigravitySteps';

puppeteer.use(StealthPlugin());

const TEST_PROXY = 'http://127.0.0.1:7897'; 
// Use local Clash/Mihomo proxy fallback so we don't need to boot the entire Ghost Fleet Gateway for a simple dry run.

async function runAntigravityStressTest() {
  console.log('🛸 启动 Antigravity & Google 账户锻造压力测试...');
  console.log(`📡 正在接入本地透明网关代理阵列: ${TEST_PROXY}`);

  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const browser = await puppeteer.launch({ 
    executablePath: chromePath, 
    headless: false, // We want to see it!
    args: [
      '--no-sandbox', 
      `--proxy-server=${TEST_PROXY}`,
      '--disable-blink-features=AutomationControlled'
    ] 
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  const ctx: any = {
    email: `antigravity.test.${Date.now()}@gmail.com`,
    page,
    browser,
    data: new Map([
        ['firstName', 'Alex'],
        ['lastName', 'Mercer'],
        ['password', '!Qwerty' + Math.floor(Math.random() * 999) + 'Xyz']
    ]),
    onProgress: (step: string, progress: number) => {
        console.log(`[${progress}%] ⏳ ${step}`);
    }
  };

  try {
    const steps = [
        new AntigravityNavigateSignupStep(),
        new AntigravityFillDetailsStep(),
        new AntigravitySelectEmailStep(),
        new AntigravityPhoneVerificationStep(),
        new AntigravityOAuthConsentStep()
    ];

    for (const step of steps) {
      console.log(`\n▶️ 执行策略节点: ${step.name}`);
      const res = await step.execute(ctx);
      if (!res.success) {
        console.error(`❌ 策略节点崩溃: ${res.error}`);
        return;
      }
    }

    console.log(`\n🎉 Google OAuth 全链路免验证注册并网成功！`);
    console.log(`📧 伪造邮箱: ${ctx.email}`);
    console.log(`🔑 伪造密码: ${ctx.data.get('password')}`);

    // Mock an OAuth payload injection
    const injector = new AntigravityTokenInjector();
    injector.rotateGoogleAccount(ctx.email);
    console.log('✅ 测试完毕: TokenInjector 执行正常。实际获取 token 后将自动覆盖本地 .gemini');

  } catch (err: any) {
    console.error(`\n❌ 致命引擎错误: ${err.message}`);
  } finally {
    console.log('🛑 压测完成，保持浏览器打开 60 秒以便复盘观察...');
    setTimeout(async () => {
      await browser.close();
      process.exit(0);
    }, 60000);
  }
}

runAntigravityStressTest().catch(console.error);
