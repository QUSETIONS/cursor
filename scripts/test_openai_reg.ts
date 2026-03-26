import { createPipelineSteps } from '../electron/engine/PipelineFactory';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { StepContext } from '../electron/engine/steps/types';

puppeteer.use(StealthPlugin());

async function run() {
  console.log('🚀 初始化 Nirvana Pipeline 测试系统 (OpenAI 模式)...');
  
  const steps = createPipelineSteps('openai');
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

  console.log('📡 启动幽灵保护壳浏览器...');
  const browser = await puppeteer.launch({ 
    executablePath: chromePath, 
    headless: false, // 设为 false 以便肉眼观察 Arkose 和点击操作
    args: ['--no-sandbox', '--proxy-server=http://127.0.0.1:50000']
  });
  const page = await browser.newPage();

  const ctx: StepContext = {
    email: 'TestAccountOpenai123@outlook.com',
    password: 'Password123!@#',
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
        throw new Error(`节点崩溃: ${res.error}`);
      }
      console.log(`✅ 节点完成: ${step.name}`);
    }

    console.log(`\n🎉 终极 OpenAI 测试结束。提取的 Session: `, ctx.data.get('openaiSession'));
  } catch (e: any) {
    console.error(`\n❌ 管线调度爆炸: ${e.message}`);
  } finally {
    // await browser.close(); 故意不关，方便用户查看停留画面
    console.log('测试网关结束，浏览器进程已保留脱离。');
    process.exit(0);
  }
}

run();
