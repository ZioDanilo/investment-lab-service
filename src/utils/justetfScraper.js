let puppeteer = null;
let browser = null;

const getPuppeteer = async () => {
  if (!puppeteer) {
    const pupModule = await import('puppeteer');
    puppeteer = pupModule.default;
  }
  return puppeteer;
};

const getBrowser = async () => {
  if (!browser) {
    const pup = await getPuppeteer();
    browser = await pup.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  }
  return browser;
};

const fetchJustEtfProfile = async (isin) => {
  let page = null;
  try {
    if (!isin) {
      return null;
    }

    const normalizedIsin = isin.trim().toUpperCase();
    const url = `https://www.justetf.com/it/etf-profile.html?isin=${normalizedIsin}`;
    console.log(`   [JustETF] Fetching: ${url}`);

    const browserInstance = await getBrowser();
    page = await browserInstance.newPage();
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(15000);
    await page.setViewport({ width: 1280, height: 720 });
    await page.goto(url, { waitUntil: 'networkidle2' });
    await page.waitForSelector('body', { timeout: 5000 });

    const result = await page.evaluate(() => {
      const parseLocalizedNumber = (rawValue) => {
        if (!rawValue) return null;
        const normalized = rawValue
          .replace(/\s/g, '')
          .replace(/\.(?=\d{3}(\D|$))/g, '')
          .replace(',', '.');
        const parsed = parseFloat(normalized);
        return Number.isFinite(parsed) ? parsed : null;
      };

      const parsePriceFromText = (rawText) => {
        if (!rawText) return null;
        const eurMatch = rawText.match(/EUR\s*([\d.,]+)/i);
        if (eurMatch && eurMatch[1]) {
          return parseLocalizedNumber(eurMatch[1]);
        }
        const euroMatch = rawText.match(/€\s*([\d.,]+)/i);
        if (euroMatch && euroMatch[1]) {
          return parseLocalizedNumber(euroMatch[1]);
        }
        return null;
      };

      const extractQuotedPrice = (rawText) => {
        if (!rawText) return null;
        const normalizedText = rawText.replace(/\s+/g, ' ').trim();
        const patterns = [
          /Quotazione\s*(?:EUR|€)?\s*([\d.,]+)/i,
          /(?:EUR|€)\s*([\d.,]+)\s*(?:\||giorno|Spread|Min\/max)/i,
          /^([\d.,]+)\s*(?:EUR|€)$/i
        ];

        for (const pattern of patterns) {
          const match = normalizedText.match(pattern);
          if (match?.[1]) {
            const parsed = parseLocalizedNumber(match[1]);
            if (parsed !== null) {
              return parsed;
            }
          }
        }

        return parsePriceFromText(normalizedText);
      };

      const inRange = (value) => value !== null && value > 0.5 && value < 5000;

      let name = document.title || '';
      if (name.includes('|')) {
        name = name.split('|')[0].trim();
      }

      let ticker = '';
      const tickerMatch = (document.body.innerText || '').match(/Ticker[:\s]+([A-Z]{2,5})/i);
      if (tickerMatch) {
        ticker = tickerMatch[1];
      }

      let quotation = null;

      const prioritizedSelectors = [
        '[data-testid*="quote"]',
        '[class*="quote"]',
        '[class*="quotation"]',
        '[class*="price"]',
        '[id*="quote"]',
        '[id*="price"]'
      ];

      for (const selector of prioritizedSelectors) {
        for (const node of Array.from(document.querySelectorAll(selector))) {
          const text = (node.textContent || '').trim();
          if (!/quotazione|eur|€/i.test(text)) {
            continue;
          }

          const parsed = extractQuotedPrice(text);
          if (inRange(parsed)) {
            quotation = parsed;
            break;
          }
        }

        if (quotation) {
          break;
        }
      }

      for (const row of Array.from(document.querySelectorAll('tr, li, div, section, article'))) {
        const text = (row.textContent || '').replace(/\s+/g, ' ').trim();
        if (!/quotazione/i.test(text)) {
          continue;
        }

        const label = (row.querySelector('th, td, strong, b, span, h1, h2, h3, h4')?.textContent || '').trim();
        if (/^Quotazione$/i.test(label) || /^Quotazione\b/i.test(text)) {
          const parsed = extractQuotedPrice(text);
          if (inRange(parsed)) {
            quotation = parsed;
            break;
          }
        }
      }

      if (!quotation) {
        const lines = (document.body.innerText || '')
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);

        for (let index = 0; index < lines.length; index += 1) {
          if (!/^Quotazione\b/i.test(lines[index])) {
            continue;
          }

          const windowText = lines.slice(index, index + 6).join(' ');
          const parsed = extractQuotedPrice(windowText);
          if (inRange(parsed)) {
            quotation = parsed;
            break;
          }
        }
      }

      if (!quotation) {
        const selectors = [
          '.quotation-price',
          '.quote-price',
          '[data-price]',
          '.infobox-value.price',
          'span[class*="price"]'
        ];
        for (const selector of selectors) {
          const node = document.querySelector(selector);
          const parsed = parsePriceFromText(node?.textContent || '');
          if (inRange(parsed)) {
            quotation = parsed;
            break;
          }
        }
      }

      return { name, ticker, quotation };
    });

    console.log(`   [JustETF] Parsed ${normalizedIsin}: quotation=${result?.quotation ?? 'ND'}`);
    return result;
  } catch (error) {
    console.error(`   [JustETF] Error for ISIN ${isin}: ${error.message}`);
    return null;
  } finally {
    if (page) {
      try {
        await page.close();
      } catch (_error) {
        // Ignore page close errors.
      }
    }
  }
};

const fetchJustEtfQuotation = async (isin) => {
  const profile = await fetchJustEtfProfile(isin);
  if (!profile || profile.quotation == null) {
    return null;
  }
  return profile.quotation;
};

module.exports = {
  fetchJustEtfProfile,
  fetchJustEtfQuotation
};
