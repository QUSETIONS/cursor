import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
puppeteer.use(StealthPlugin());

async function getSiteKey() {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const browser = await puppeteer.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  console.log('Navigating...');
  await page.goto('https://authenticator.cursor.sh/sign-up', { waitUntil: 'networkidle2' });
  
  // Look for Turnstile sitekey in DOM
  const sitekey = await page.evaluate(() => {
    // Check turnstile div
    const tsNode = document.querySelector('.cf-turnstile, [data-sitekey]');
    if (tsNode) return tsNode.getAttribute('data-sitekey');
    
    // Check iframe src
    const iframes = Array.from(document.querySelectorAll('iframe'));
    for (const frame of iframes) {
      if (frame.src.includes('turnstile') && frame.src.includes('sitekey=')) {
        const url = new URL(frame.src);
        return url.searchParams.get('sitekey');
      }
    }
    return null;
  });
  
  console.log('SiteKey found:', sitekey);
  await browser.close();
}

getSiteKey().catch(console.error);
