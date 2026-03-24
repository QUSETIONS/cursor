import { BrowserService } from '../electron/services/BrowserService';
import { IPSwitchService } from '../electron/services/IPSwitchService';
import { createEmailService } from '../electron/services/EmailServiceFactory';
import { RegistrationPipeline } from '../electron/engine/RegistrationPipeline';
import fs from 'fs';
import path from 'path';

async function main() {
  const numAccounts = parseInt(process.env.ACCOUNTS_COUNT || '3');
  
  console.log('═══════════════════════════════════════════════════');
  console.log('  🚀 Azure IPv6 Cloud Registration Engine');
  console.log('═══════════════════════════════════════════════════');

  // 1. Setup Services
  const browserService = new BrowserService();
  const ipService = new IPSwitchService(); // default system IP (Azure IPv6 automatically used)
  const emailService = createEmailService({ type: 'mailtm' }); // Uses free unlimited REST API emails
  const pipeline = new RegistrationPipeline(browserService, ipService, emailService);

  // 2. Generate Temp Emails
  console.log(`[+] Generating ${numAccounts} temp email accounts via mail.tm...`);
  const emails = [];
  for (let i = 0; i < numAccounts; i++) {
    try {
      const tmp = await emailService.createEmail();
      emails.push(tmp.address);
      console.log(`    -> [${i+1}/${numAccounts}] Generated: ${tmp.address}`);
    } catch (e) {
      console.error(`    -> Failed to generate email:`, e);
    }
    // Small delay between mail.tm creations to avoid rate limits
    await new Promise(r => setTimeout(r, 1000));
  }

  if (emails.length === 0) {
    console.error('❌ Failed to generate any email addresses. Exiting.');
    process.exit(1);
  }

  // 3. Execution
  console.log(`\n[+] Starting Headless Pipeline on Azure IPv6 Network...`);
  const results = await pipeline.execute({
    emails,
    imapAccounts: [],
    browserConfig: {
      useProxy: false,
      incognito: true,
      headless: true
    },
    savePath: path.resolve('data'),
    interval: 3,
    deleteMailAfterRead: false,
    fetchTokenAfterRegister: true,
    timeout: 60000,
    concurrency: 1 // Run sequentially on standard GitHub runner to conserve memory
  });

  // 4. Save structured JSON for artifact upload
  const outDir = path.resolve('data');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  
  const successResults = results.filter(r => r.success);
  console.log(`\n✅ Run Complete. Successfully registered: ${successResults.length} / ${emails.length}`);

  const summaryData = {
    timestamp: new Date().toISOString(),
    totalAttempted: emails.length,
    successCount: successResults.length,
    accounts: successResults.map(r => ({
      email: r.email,
      password: r.password,
      token: r.accessToken
    }))
  };

  fs.writeFileSync(
    path.join(outDir, 'actions_register_summary.json'),
    JSON.stringify(summaryData, null, 2),
    'utf-8'
  );
  
  // Create readable token files for easy access
  for (const acc of summaryData.accounts) {
    if (acc.token) {
      fs.writeFileSync(
        path.join(outDir, `${acc.email}.txt`),
        acc.token,
        'utf-8'
      );
    }
  }

  console.log(`\n💾 Saved all tokens to data/ directory for Github Artifact Export!`);
  
  // Cleanup browser properly
  browserService.cleanup?.();
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal Pipeline Error:', err);
  process.exit(1);
});
