import puppeteer from 'puppeteer';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});

const page = await browser.newPage();
const seen = [];

page.on('request', (req) => {
  const url = req.url();
  if (url.includes('/api/market-universe/portfolio/projection/binary') || url.includes('/api/portfolio/') || url.includes('/api/market-universe/active')) {
    seen.push({ url, method: req.method(), post: req.postData ? req.postData() : null });
  }
});

page.on('response', (res) => {
  if (res.url().includes('/api/market-universe/portfolio/projection/binary')) {
    console.log('BINARY_RESPONSE', res.status(), res.headers()['content-type'] || '', String(res.headers()['content-length'] || ''));
  }
});

await page.goto('http://localhost:4200/monte-carlo', { waitUntil: 'domcontentloaded', timeout: 120000 });
await wait(4000);

const soniaButton = await page.$x("//button[contains(., 'Sonia')] | //span[contains(., 'Sonia')] | //div[contains(., 'Sonia')] ");
if (soniaButton.length > 0) {
  console.log('SONIA_COUNT', soniaButton.length);
  await soniaButton[0].click();
  await wait(2000);
}

const runButton = await page.$('button[aria-label="Avvia simulazione"]');
console.log('RUN_BUTTON_COUNT', runButton ? 1 : 0);
if (runButton) {
  await runButton.click();
}

await wait(20000);
const text = await page.evaluate(() => document.body.innerText || '');
console.log('BODY_SNIPPET', text.slice(0, 1500));
console.log('OBSERVED_REQUESTS', JSON.stringify(seen, null, 2));

await browser.close();
