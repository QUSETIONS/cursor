import { EventEmitter } from 'node:events';
import Imap from 'imap';
import { BrowserService } from './BrowserService';
import { createLogger } from '../utils/Logger';

export interface VerifyResult {
  email: string;
  status: 'alive' | 'dead' | 'error';
  error?: string;
}

export class OutlookService extends EventEmitter {
  private log = createLogger('OutlookService');
  private browserService: BrowserService;
  private isStopped = false;

  constructor(browserService: BrowserService) {
    super();
    this.browserService = browserService;
  }

  stop() {
    this.isStopped = true;
    this.emit('log', '🛑 收到了停止指令');
  }

  // ─── IMAP Verifier ───
  async verifyBatch(emails: string[]): Promise<VerifyResult[]> {
    this.isStopped = false;
    const results: VerifyResult[] = [];
    
    for (let i = 0; i < emails.length; i++) {
      if (this.isStopped) break;
      const line = emails[i].trim();
      if (!line) continue;
      
      const parts = line.split('----');
      if (parts.length < 2) continue;
      
      const [email, password] = parts;
      this.emit('progress', { current: i + 1, total: emails.length, text: `正在验证 ${email}...` });
      this.emit('log', `🔍 [${i+1}/${emails.length}] 开始验证: ${email}`);

      try {
        const isAlive = await this.verifyImap(email, password);
        results.push({ email, status: isAlive ? 'alive' : 'dead' });
        this.emit('log', isAlive ? `✅ ${email} - 状态活跃` : `❌ ${email} - 无法登录或已被封禁`);
      } catch (e: any) {
        results.push({ email, status: 'error', error: e.message });
        this.emit('log', `⚠️ ${email} - 验证出错: ${e.message}`);
      }
      
      await new Promise(r => setTimeout(r, 1000));
    }
    
    this.emit('log', '🎉 验证任务结束');
    this.emit('progress', { current: emails.length, total: emails.length, text: `验证结束` });
    return results;
  }

  private verifyImap(user: string, password: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const imap = new Imap({
        user,
        password,
        host: 'outlook.office365.com',
        port: 993,
        tls: true,
        tlsOptions: { rejectUnauthorized: false },
        authTimeout: 15000,
      });

      imap.once('ready', () => {
        imap.end();
        resolve(true);
      });

      imap.once('error', (err: any) => {
        if (err.message && err.message.includes('AUTHENTICATE failed')) {
          resolve(false);
        } else {
          // Could be network error or imap disabled
          resolve(false); 
        }
      });

      imap.connect();
    });
  }

  // ─── Semi-Automated Register ───
  async registerBatch(count: number, prefix: string, password?: string) {
    this.isStopped = false;
    this.emit('log', '⚠️ 提示：自动化注册仅提供辅助打开页面，CAPTCHA和手机验证需手动处理');
    
    for (let i = 0; i < count; i++) {
      if (this.isStopped) break;
      
      const pass = password || `Abc${Math.random().toString(36).slice(2, 10)}!`;
      let email = prefix;
      if (email.includes('{{random}}')) email = email.replace('{{random}}', Math.random().toString(36).slice(2, 8));
      if (email.includes('{{num}}')) email = email.replace('{{num}}', String(i+1));
      if (!email.includes('@')) email += '@outlook.com';

      this.emit('progress', { current: i + 1, total: count, text: `正在创建浏览器 ${email}...` });
      this.emit('log', `▶️ 打开浏览器，准备注册: ${email}`);
      
      let envId: string | undefined;
      let browser: any;
      
      try {
        const env = await this.browserService.createEnvironment();
        envId = env.id;
        
        const puppeteer = require('puppeteer-extra');
        const StealthPlugin = require('puppeteer-extra-plugin-stealth');
        puppeteer.use(StealthPlugin());
        
        browser = await puppeteer.connect({
          browserWSEndpoint: env.wsEndpoint,
          defaultViewport: null,
        });
        
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });
        await page.goto('https://signup.live.com/signup', { waitUntil: 'load' });
        
        this.emit('log', `⏳ 等待用户在浏览器中手动完成人机验证/注册... [密码: ${pass}]`);
        
        // Block until page is closed by user or script stopped
        while(!page.isClosed() && !this.isStopped) {
          await new Promise(r => setTimeout(r, 2000));
          try {
            const url = page.url();
            if (url.includes('mail.live.com') || url.includes('outlook.live.com/mail')) {
              this.emit('log', `✅ 检测到成功登录: ${email}----${pass}`);
              break;
            }
          } catch(e) {
             // Page might be closed mid-check
             break;
          }
        }
        
        if (!page.isClosed()) await page.close();
      } catch (e: any) {
        this.emit('log', `❌ 错误: ${e.message}`);
      } finally {
        if (browser) await browser.disconnect().catch(() => {});
        if (envId) await this.browserService.destroyEnvironment(envId).catch(() => {});
      }
    }
    
    this.emit('log', '🎉 注册任务结束');
    this.emit('progress', { current: count, total: count, text: `注册结束` });
  }

  // ─── Semi-Automated Forward Setup ───
  async forwardSetupBatch(emails: string[], targetEmail: string) {
    this.isStopped = false;
    this.emit('log', '⚠️ 提示：自动设置转发极其容易被微软风控阻断，推荐手动...');
    
    for (let i = 0; i < emails.length; i++) {
      if (this.isStopped) break;
      const line = emails[i].trim();
      if (!line) continue;
      
      const parts = line.split('----');
      if (parts.length < 2) continue;
      
      const [email, password] = parts;
      this.emit('progress', { current: i + 1, total: emails.length, text: `配置转发 ${email}...` });
      this.emit('log', `▶️ 打开浏览器，准备配置转发: ${email} -> ${targetEmail}`);
      
      let envId: string | undefined;
      let browser: any;
      
      try {
        const env = await this.browserService.createEnvironment();
        envId = env.id;
        
        const puppeteer = require('puppeteer-extra');
        const StealthPlugin = require('puppeteer-extra-plugin-stealth');
        puppeteer.use(StealthPlugin());
        
        browser = await puppeteer.connect({
          browserWSEndpoint: env.wsEndpoint,
          defaultViewport: null,
        });
        
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });
        await page.goto('https://login.live.com/', { waitUntil: 'load' });
        
        this.emit('log', `⏳ 请手动登录账号并在设置中开启转发，或关闭浏览器跳过。`);
        
        while(!page.isClosed() && !this.isStopped) {
          await new Promise(r => setTimeout(r, 2000));
        }
        
        if (!page.isClosed()) await page.close();
      } catch (e: any) {
        this.emit('log', `❌ 错误: ${e.message}`);
      } finally {
        if (browser) await browser.disconnect().catch(() => {});
        if (envId) await this.browserService.destroyEnvironment(envId).catch(() => {});
      }
    }
    this.emit('log', '🎉 转发配置结束');
    this.emit('progress', { current: emails.length, total: emails.length, text: `转发配置结束` });
  }
}
