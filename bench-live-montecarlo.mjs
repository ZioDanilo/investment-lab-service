import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  defaultViewport: { width: 1440, height: 1200 }
});

const page = await browser.newPage();
page.on('console', (msg) => console.log('BROWSER_CONSOLE', msg.type(), msg.text()));
page.on('pageerror', (err) => console.log('PAGEERROR', err.message));
page.on('requestfailed', (req) => console.log('REQUEST_FAILED', req.url(), req.failure()?.errorText || 'none'));

const logs = [];
page.on('console', (msg) => {
  const text = msg.text();
  if (text.includes('[MC-TRACE') || text.includes('RESULTS_RENDERED') || text.includes('SIMULATION_SUCCESS') || text.includes('PRECOMPUTE') || text.includes('RUN_BATCH') || text.includes('distributionTransformMs') || text.includes('monthlyReturnVectorsMs') || text.includes('portfolioEvolutionMs') || text.includes('worker')) {
    logs.push(text);
  }
});

try {
  console.log('NAVIGATE_START');
  await page.goto('http://127.0.0.1:4200/monte-carlo', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(8000);

  const initial = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    bodyText: document.body.innerText.slice(0, 2500),
    buttons: [...document.querySelectorAll('button')].slice(0, 15).map((b) => ({
      text: (b.textContent || '').replace(/\s+/g, ' ').trim(),
      disabled: !!b.disabled,
      ariaLabel: b.getAttribute('aria-label') || ''
    })),
    h1: [...document.querySelectorAll('h1, h2, h3')].slice(0, 10).map((el) => (el.textContent || '').trim())
  }));
  console.log('INITIAL_STATE', JSON.stringify(initial, null, 2));

  const runButton = await page.$x("//button[contains(., 'AVVIA SIMULAZIONE') or contains(., 'AVVIA')] | //button[normalize-space()='AVVIA SIMULAZIONE']");
  console.log('RUN_BUTTON_COUNT', runButton.length);

  if (runButton.length > 0) {
    console.log('CLICK_RUN_BUTTON');
    await runButton[0].click();
    await page.waitForTimeout(15000);
  }

  const after = await page.evaluate(() => ({
    url: location.href,
    bodyText: document.body.innerText.slice(0, 3000),
    buttons: [...document.querySelectorAll('button')].slice(0, 20).map((b) => ({
      text: (b.textContent || '').replace(/\s+/g, ' ').trim(),
      disabled: !!b.disabled
    })),
    progressText: document.body.innerText.match(/\d+%/g)?.slice(0, 10) || []
  }));
  console.log('AFTER_CLICK_STATE', JSON.stringify(after, null, 2));

  await page.waitForTimeout(60000);
  const final = await page.evaluate(() => ({
    url: location.href,
    bodyText: document.body.innerText.slice(0, 4000),
    progressText: document.body.innerText.match(/\d+%/g)?.slice(0, 20) || [],
    buttonSummary: [...document.querySelectorAll('button')].slice(0, 20).map((b) => ({
      text: (b.textContent || '').replace(/\s+/g, ' ').trim(),
      disabled: !!b.disabled
    }))
  }));
  console.log('FINAL_STATE', JSON.stringify(final, null, 2));

  console.log('TRACE_LOGS', JSON.stringify(logs.slice(-100), null, 2));
} catch (error) {
  console.log('SCRIPT_ERROR', error?.stack || String(error));
} finally {
  await browser.close();
}
