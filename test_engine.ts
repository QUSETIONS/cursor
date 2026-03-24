import { RegistrationPipeline } from './electron/engine/RegistrationPipeline';
import { BrowserService } from './electron/services/BrowserService';
import { IPSwitchService } from './electron/services/IPSwitchService';
import { createEmailService } from './electron/services/EmailServiceFactory';
import { ImapService } from './electron/services/ImapService';

async function runTest() {
  console.log('--- Starting Nirvana Engine E2E Test ---');

  // We use MoeMail to completely bypass IMAP configuration constraints
  const emailService = createEmailService({ type: 'moemail' });
  const browserService = new BrowserService();
  const ipService = new IPSwitchService();

  // Initialize
  await browserService.start();
  await ipService.start();

  const pipeline = new RegistrationPipeline(browserService, ipService, emailService);

  try {
    console.log('1. Attempting to create a temporary MoeMail account...');
    const tempEmail = await emailService.createEmail();
    console.log(`Temp email generated: ${tempEmail.address}`);

    console.log('2. Running RegistrationPipeline for platform: cursor');
    const results = await pipeline.execute({
      platform: 'cursor',
      emails: [tempEmail.address],
      imapAccounts: [], // No longer used directly, but kept for interface compatibility
      browserConfig: {
        headless: false, // Show browser to verify real process
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
