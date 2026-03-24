import dotenv from 'dotenv';
import { randomUUID } from 'crypto';
import { Logger } from '../electron/utils/Logger';
import { BrowserService } from '../electron/services/BrowserService';
import { ImapService } from '../electron/services/ImapService';
import { createEmailService } from '../electron/services/EmailServiceFactory';
import { RegistrationPipeline } from '../electron/engine/RegistrationPipeline';
import { ConcurrentScheduler } from '../electron/engine/ConcurrentScheduler';

dotenv.config();

const logger = Logger.create('HeadlessWorker');

async function main() {
  logger.info('=== Starting Headless Registration Worker ===');

  const proxyPoolUrl = process.env.PROXY_POOL_URL || 'http://localhost:8000';
  const concurrency = parseInt(process.env.WORKER_CONCURRENCY || '5', 10);
  const catchAllDomain = process.env.CATCH_ALL_DOMAIN;
  const imapHost = process.env.IMAP_HOST;
  const imapPort = parseInt(process.env.IMAP_PORT || '993', 10);
  const imapUser = process.env.IMAP_USER;
  const imapPass = process.env.IMAP_PASS;
  const targetPlatform = process.env.TARGET_PLATFORM || 'windsurf';

  if (!catchAllDomain || !imapHost || !imapUser || !imapPass) {
    logger.error('CRITICAL: Missing Catch-All IMAP configuration in ENV variables.');
    process.exit(1);
  }

  // Initialize core services
  const browserService = new BrowserService();
  await browserService.start();

  const imapService = new ImapService();
  await imapService.start();

  // Create Email and IP Services (pass null for IP if using dynamic proxies per browser)
  // For Docker farm, we fetch proxies directly from the Proxy Pool API
  const emailService = createEmailService({ type: 'moemail' });
  const ipService = null; // We will bypass IPSwitchService and pass proxy directly to browser config

  const scheduler = new ConcurrentScheduler({ maxConcurrent: concurrency });
  const pipeline = new RegistrationPipeline(browserService, ipService as any, emailService);
  
  // Override internal scheduler
  (pipeline as any).scheduler = scheduler;

  logger.info(`Farm spinning up with concurrency ${concurrency} targeting ${targetPlatform}`);

  const imapAccounts = [{
    id: 'headless-master',
    email: imapUser,
    password: imapPass,
    host: imapHost,
    port: imapPort,
    tls: true,
    enabled: true
  }];

  const catchAllConfig = {
    enabled: true,
    domain: catchAllDomain,
    imapHost,
    imapPort,
    imapUser,
    imapPass,
    imapTls: true,
    targetCount: 1 // We run infinite loops submitting one at a time to the scheduler
  };

  // Infinite Registration Loop
  let tasksDispatched = 0;

  setInterval(async () => {
    // If the scheduler has room, feed it more tasks
    if (scheduler.getStats().running + scheduler.getStats().queued < concurrency * 2) {
      const email = `${randomUUID().split('-')[0]}@${catchAllDomain}`;
      
      logger.info(`Dispatching task for ${email}...`);
      tasksDispatched++;

      // We need to fetch a GOLDEN proxy
      let proxyConfig = undefined;
      let leaseId = undefined;
      
      try {
        const res = await fetch(`${proxyPoolUrl}/proxies/golden/lease?lease_duration=300`, { method: 'POST' });
        if (res.ok) {
          const data = await res.json() as any;
          if (data.proxy) {
            proxyConfig = {
              enabled: true,
              type: data.proxy.protocol === 'socks5' ? 'socks5' : 'http',
              host: data.proxy.ip,
              port: data.proxy.port,
              username: '',
              password: ''
            };
            leaseId = data.proxy.host; // Host is unique ID
          }
        }
      } catch (e) {
        logger.warn('Failed to lease GOLDEN proxy. Falling back to direct / adb mode if configured.');
      }

      pipeline.execute({
        emails: [email],
        imapAccounts,
        catchAllConfig,
        browserConfig: {
          type: 'vb',
          cdpPort: 9222 + (tasksDispatched % concurrency),
          vbDynamicEnv: true,
          vbApiKey: '',
          vbBaseURL: 'http://127.0.0.1:9000',
          vbChromeVersion: 132,
          vbGroupId: '',
          vbExecutablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
          nstApiKey: '',
          nstProfileId: '',
          nstUseOnceBrowser: false
        },
        ipConfig: proxyConfig as any, // Injected fetched proxy
        captchaConfig: { type: 'yescaptcha', apiKey: process.env.YESCAPTCHA_KEY || '' },
        savePath: './output_tokens.txt',
        interval: 0,
        deleteMailAfterRead: false,
        fetchTokenAfterRegister: true,
        timeout: 120000,
        platformOverride: targetPlatform,
        bindCardData: process.env.VCC_NUMBER ? {
          number: process.env.VCC_NUMBER,
          expMonth: process.env.VCC_EXP_M || '',
          expYear: process.env.VCC_EXP_Y || '',
          cvc: process.env.VCC_CVC || '',
          name: process.env.VCC_NAME || '',
          zip: process.env.VCC_ZIP || ''
        } : undefined
      }).then(async (results) => {
        if (leaseId) {
          try {
            await fetch(`${proxyPoolUrl}/proxies/golden/release?host=${leaseId}`, { method: 'POST' });
          } catch {}
        }
        logger.info(`Task for ${email} completed. Success: ${results.some(r => r.success)}`);
      }).catch(async (e) => {
        if (leaseId) {
          try {
            await fetch(`${proxyPoolUrl}/proxies/golden/release?host=${leaseId}`, { method: 'POST' });
          } catch {}
        }
        logger.error(`Task for ${email} failed: ${e}`);
      });
    }
  }, 2000);

  // Keep process alive
  process.on('SIGINT', async () => {
    logger.info('Shutting down worker...');
    await browserService.stop();
    await imapService.stop();
    process.exit(0);
  });
}

main().catch(console.error);
