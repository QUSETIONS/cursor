import { RegistrationPipeline } from './electron/engine/RegistrationPipeline';
import { BrowserService } from './electron/services/BrowserService';
import { IPSwitchService } from './electron/services/IPSwitchService';
import { createEmailService } from './electron/services/EmailServiceFactory';
import { ImapService } from './electron/services/ImapService';

async function runTest() {
  console.log('--- Starting Nirvana Engine E2E Test ---');

  // We use Gmail IMAP with Catch-All Domain
  const emailService = createEmailService({ 
    type: 'imap',
    imapUser: process.env.IMAP_USER || '',
    imapPass: process.env.IMAP_PASS || '',
    imapHost: 'imap.gmail.com',
    imapPort: 993,
  });
  const browserService = new BrowserService();
  const ipService = new IPSwitchService();

  // Initialize services
  await browserService.start();
  await ipService.start();
  
  const { ProxyPoolService } = require('./electron/services/ProxyPoolService');
  const proxyPool = ProxyPoolService.getInstance();
  proxyPool.addProxy({
    protocol: 'http',
    host: '127.0.0.1',
    port: 7897,
    provider: 'Local Router (Mihomo/Clash)',
    country: 'local',
    enabled: true,
    activeConnections: 0,
    lastUsedAt: 0,
    ipv6Capable: true,
    qualityScore: 100, // Top priority
    source: 'local-mihomo',
  });
  
  // Start the underlying CAPTCHA cracking engine (The Foundry) on port 8191
  try {
    const { startSolverServer } = require('./electron/services/solver/SolverServer');
    startSolverServer();
    console.log('[Foundry] The CAPTCHA Solver API is running on localhost:8191');
  } catch (e) {
    console.error('Failed to start Foundry:', e);
  }

  const pipeline = new RegistrationPipeline(browserService, ipService, emailService);

  try {
    console.log('1. Attempting to create a Catch-All email...');
    const prefix = Math.random().toString(36).substring(2, 10);
    const catchAllDomain = 'nirvana-farm-2026.cyou';
    const tempEmailAddress = `${prefix}@${catchAllDomain}`;
    console.log(`Catch-All email generated: ${tempEmailAddress}`);

    console.log('2. Running RegistrationPipeline for platform: cursor');
    const results = await pipeline.execute({
      platform: 'cursor',
      emails: [tempEmailAddress],
      imapAccounts: [], // No longer used directly, but kept for interface compatibility
      browserConfig: {
        headless: true, // Show browser to verify real process
        concurrencyLimit: 1,
      },
      savePath: './data/test_output',
      interval: 2,
      deleteMailAfterRead: true,
      fetchTokenAfterRegister: true,
      timeout: 120000,
    });

    console.log('--- Test Finished ---');
    console.log(JSON.stringify(results, null, 2));
  } catch (err) {
    console.error('Test strictly failed:', err);
  } finally {
    await browserService.stop();
    await ipService.stop();
    // Force exit
    process.exit(0);
  }
}

runTest();
