import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
puppeteer.use(StealthPlugin());

async function getSiteKey() {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const browser = await puppeteer.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  
  let sitekey = null;
  
  // Intercept network requests
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = request.url();
    if (url.includes('turnstile') && url.includes('sitekey=')) {
      try {
        const parsed = new URL(url);
        sitekey = parsed.searchParams.get('sitekey');
        console.log('[Net] Found via query param:', sitekey);
      } catch (e) {}
    } else if (url.includes('/turnstile/') || url.includes('challenges.cloudflare.com/cdn-cgi/challenge-platform/')) {
      // e.g. https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/g/turnstile/if/ov2/av0/rcv0/0/m3n9/0x4AAAAAAAK-A0Q1q5hP1x8G/light/invisible
      // The sitekey usually follows the /0/xxx/ path
      const match = url.match(/0x[A-Za-z0-9_-]{20,}/);
      if (match) {
        sitekey = match[0];
        console.log('[Net] Found via path match:', sitekey);
      }
    }
    request.continue();
  });

  console.log('Navigating...');
  await page.goto('https://authenticator.cursor.sh/sign-up', { waitUntil: 'networkidle2' });
  
  await new Promise(r => setTimeout(r, 5000)); // Wait for turnstile to load

  console.log('Final SiteKey:', sitekey);
  await browser.close();
}

getSiteKey().catch(console.error);
