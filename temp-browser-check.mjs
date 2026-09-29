import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const page = await browser.newPage();
page.on('console', (msg) => console.log('BROWSER_CONSOLE', msg.type(), msg.text()));
page.on('pageerror', (err) => console.log('PAGEERROR', err.message));
page.on('requestfailed', (req) => console.log('REQUEST_FAILED', req.url(), req.failure()?.errorText || 'none'));

try {
  await page.goto('http://127.0.0.1:4200/monte-carlo', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(15000);
  const info = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')].map((b) => ({
      text: (b.textContent || '').replace(/\s+/g, ' ').trim(),
      disabled: !!b.disabled,
      ariaLabel: b.getAttribute('aria-label') || ''
    }));
    const selects = [...document.querySelectorAll('select')].map((s) => ({
      name: s.getAttribute('name') || '',
      value: s.value,
      options: [...s.options].map((o) => o.textContent || '')
    }));
    return {
      url: location.href,
      title: document.title,
      bodyText: document.body.innerText.slice(0, 3000),
      buttonCount: buttons.length,
      buttons,
      selectCount: selects.length,
      selects
    };
  });
  console.log(JSON.stringify(info, null, 2));
} catch (error) {
  console.error('SCRIPT_ERROR', error && error.stack ? error.stack : String(error));
} finally {
  await browser.close();
}
