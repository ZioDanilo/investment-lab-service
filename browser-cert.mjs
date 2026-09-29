import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
  defaultViewport: { width: 1440, height: 1200 }
});

const page = await browser.newPage();

const requestLog = [];
const responseMap = new Map();

page.on('request', (request) => {
  const url = request.url();
  if (url.includes('/api/portfolio') || url.includes('/api/market-universe')) {
    requestLog.push({ type: 'request', url, method: request.method() });
  }
});

page.on('response', async (response) => {
  const url = response.url();
  if (url.includes('/api/portfolio') || url.includes('/api/market-universe')) {
    responseMap.set(url, {
      status: response.status(),
      headers: response.headers(),
      contentType: response.headers()['content-type']
    });
  }
});

await page.goto('http://localhost:4200/monte-carlo', { waitUntil: 'networkidle2', timeout: 120000 });

console.log('TITLE:', await page.title());
console.log('URL:', page.url());
console.log('BUTTONS:', await page.evaluate(() => {
  return Array.from(document.querySelectorAll('button')).slice(0, 20).map((b) => b.textContent.trim().replace(/\s+/g, ' '));
}));
console.log('BODY:', (await page.evaluate(() => document.body.innerText)).slice(0, 2000));

await browser.close();
console.log('REQUESTS:', JSON.stringify(requestLog, null, 2));
console.log('RESPONSES:', JSON.stringify([...responseMap.entries()].slice(0, 20), null, 2));
