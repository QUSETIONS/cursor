import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Logger } from '../../utils/Logger';

// 启用隐形组件
puppeteer.use(StealthPlugin());

export interface SolveRequest {
  url: string;
  proxy?: string; // e.g. socks5://127.0.0.1:1080
  timeoutMs?: number;
}

export interface SolveResponse {
  status: 'success' | 'failed' | 'timeout';
  token?: string;
  error?: string;
  userAgent?: string;
}

export class TurnstileSolver {
  private logger = Logger.create('TurnstileSolver');
  private chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

  /**
   * 启动极致隐匿环境并提取验证码 Token
   */
  public async solve(req: SolveRequest): Promise<SolveResponse> {
    const timeout = req.timeoutMs || 45000;
    this.logger.info(`开始破解任务: ${req.url.substring(0, 40)}... | Proxy: ${req.proxy || 'None'} | Timeout: ${timeout}ms`);

    const args = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'];
    if (req.proxy) args.push(`--proxy-server=${req.proxy}`);

    let browser: any = null;
    try {
      browser = await puppeteer.launch({
        executablePath: this.chromePath,
        headless: true,
        args,
        ignoreHTTPSErrors: true
      });

      const page = await browser.newPage();
      
      // 随机化 User-Agent (简单替换特征)
      const defaultUa = await browser.userAgent();
      const cleanUa = defaultUa.replace('HeadlessChrome', 'Chrome').replace(/\s?Version\/[\d.]+\s?/, ' ');
      await page.setUserAgent(cleanUa);

      // 设置拦截器，提取 Turnstile token
      let capturedToken: string | null = null;
      
      // 等待 Turnstile 将 Token 写入 DOM 或网络拦截
      await page.setRequestInterception(true);
      page.on('request', (request: any) => request.continue());
      page.on('response', async (response: any) => {
        const url = response.url();
        // 有些实现会通过 AJAX 提交，或者打码结束时会载入某个携带特征的资源
        if (url.includes('turnstile') && response.status() === 200) {
          // 这里我们主要依靠 DOM 探测
        }
      });

      this.logger.info(`导航至目标页面...`);
      await page.goto(req.url, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // 核心轮询逻辑：监控 DOM 中是否出现了有效的 cf-turnstile-response
      // Turnstile 在不可见模式过关后，会将 token 写入 hidden input 中
      const startTime = Date.now();
      while (Date.now() - startTime < timeout) {
        capturedToken = await page.evaluate(() => {
          const input = document.querySelector('input[name="cf-turnstile-response"]') as HTMLInputElement;
          return input && input.value && input.value.length > 20 ? input.value : null;
        });

        if (capturedToken) {
          this.logger.info(`成功捕获 Turnstile Token: ${capturedToken.substring(0, 30)}...`);
          return { status: 'success', token: capturedToken, userAgent: cleanUa };
        }
        await new Promise(r => setTimeout(r, 1000));
      }

      return { status: 'timeout', error: '超时未发现 Token' };

    } catch (err: any) {
      this.logger.error(`破译引擎崩溃: ${err.message}`);
      return { status: 'failed', error: err.message };
    } finally {
      if (browser) await browser.close();
    }
  }
}
