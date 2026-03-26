import { createPipelineSteps } from '../electron/engine/PipelineFactory';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { StepContext } from '../electron/engine/steps/types';

puppeteer.use(StealthPlugin());

async function run() {
  console.log('🚀 初始化 Nirvana Pipeline 测试系统 (Claude DataDome Bypass Mode)...');
  
  const steps = createPipelineSteps('claude');
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

  console.log('📡 启动具备伪真机模拟的幽灵浏览器...');
  const browser = await puppeteer.launch({ 
    executablePath: chromePath, 
    headless: false, // 设为 false 以便肉眼观察鼠标缓动效果和背选退格打字
    args: ['--no-sandbox', '--proxy-server=http://127.0.0.1:50000'],
    ignoreDefaultArgs: ['--enable-automation']
  });
  const page = await browser.newPage();

  const ctx: StepContext = {
    email: 'TestAccountClaude999@outlook.com',
    browser,
    page,
    config: { deleteMailAfterRead: false, fetchTokenAfterRegister: true, timeout: 60000 },
    data: new Map(),
    onProgress: (step, progress) => {
      console.log(`[${progress}%] ⏳ ${step}`);
    }
  };

  try {
    for (const step of steps) {
      console.log(`\n================ 执行节点: ${step.name} ================`);
      const res = await step.execute(ctx);
      if (res.skip) {
        console.log(`⏭️ 节点主动跳过: ${step.name}`);
        continue;
      }
      if (!res.success) {
        throw new Error(`节点崩溃/被风控阻断: ${res.error}`);
      }
      console.log(`✅ 节点突破完成: ${step.name}`);
    }

    console.log(`\n🎉 终极 Claude 测试结束。提取的 SessionKey: `, ctx.data.get('claudeSession'));
  } catch (e: any) {
    console.error(`\n❌ 管线调度爆炸: ${e.message}`);
  } finally {
    console.log('测试挂起，你可以切回浏览器窗口检查 DataDome 是否锁定了你。');
    process.exit(0);
  }
}

run();
