import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Logger } from '../../utils/Logger';

puppeteer.use(StealthPlugin());

export interface ArkoseSolveOptions {
  url: string;
  proxy?: string;
  timeoutMs?: number;
}

export interface ArkoseResult {
  status: 'success' | 'failed';
  token?: string;
  error?: string;
}

export class ArkoseSolver {
  private logger = Logger.create('ArkoseSolver');
  private chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

  public async solve(options: ArkoseSolveOptions): Promise<ArkoseResult> {
    const { url, proxy, timeoutMs = 60000 } = options;
    this.logger.info(`🚨 [Arkose] Initiating evasion for ${url}`);
    
    let browser: any = null;
    try {
      const args = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled',
      ];
      if (proxy) args.push(`--proxy-server=${proxy}`);

      browser = await puppeteer.launch({
        executablePath: this.chromePath,
        headless: true, // For real Arkose, we might need false or XVFB
        args,
        ignoreHTTPSErrors: true
      });

      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

      // Intercept the Arkose request/responses
      let extractedToken: string | null = null;
      page.on('response', async (res: any) => {
        const reqUrl = res.url();
        if (reqUrl.includes('arkoselabs.com') && reqUrl.includes('token')) {
            try {
               const text = await res.text();
               if (text.includes('token')) {
                   const match = text.match(/"token"\s*:\s*"([^"]+)"/);
                   if (match) extractedToken = match[1];
               }
            } catch(e) {}
        }
      });

      this.logger.info(`[Arkose] Navigating to target portal...`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });

      // Simulate human idle time
      await page.waitForTimeout(5000);

      const frame = await page.frames().find((f: any) => f.url().includes('arkoselabs.com'));
      
      let attempts = 0;
      while (!extractedToken && attempts < (timeoutMs / 2000)) {
         await page.waitForTimeout(2000);
         attempts++;
      }

      if (extractedToken) {
        this.logger.info(`[Arkose] Successfully extracted token via network interception.`);
        return { status: 'success', token: extractedToken };
      }

      throw new Error('Arkose execution failed or timeout. Re-challenge required.');
    } catch (e: any) {
      this.logger.error(`[Arkose] ${e.message}`);
      return { status: 'failed', error: e.message };
    } finally {
      if (browser) await browser.close();
    }
  }
}
