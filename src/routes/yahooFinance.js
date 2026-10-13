const express = require('express');
const router = express.Router();
const BASE = 'https://query1.finance.yahoo.com';
const allowed = /^[A-Za-z0-9^._=\-]{1,40}$/;
async function yahoo(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(BASE + path, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } });
    const body = await response.text();
    if (!response.ok) return { error: { status: response.status, body: body.slice(0, 1200) } };
    return JSON.parse(body);
  } finally { clearTimeout(timer); }
}
router.get('/diagnostic', async (req, res) => {
  const symbol = String(req.query.symbol || 'IWDA.AS').trim();
  if (!allowed.test(symbol)) return res.status(400).json({ success: false, error: 'Invalid ticker' });
  const encoded = encodeURIComponent(symbol);
  const paths = {
    history: '/v8/finance/chart/' + encoded + '?range=2y&interval=1d&events=div%2Csplits',
    quote: '/v7/finance/quote?symbols=' + encoded,
    summary: '/v10/finance/quoteSummary/' + encoded + '?modules=price%2CsummaryDetail%2CdefaultKeyStatistics%2CfundProfile'
  };
  const entries = await Promise.all(Object.entries(paths).map(async ([key, path]) => {
    try { return [key, await yahoo(path)]; } catch (error) { return [key, { error: String(error.message || error) }]; }
  }));
  const raw = Object.fromEntries(entries);
  const chart = raw.history?.chart?.result?.[0] || null;
  const quote = raw.quote?.quoteResponse?.result?.[0] || null;
  const modules = raw.summary?.quoteSummary?.result?.[0] || null;
  const detail = modules?.summaryDetail || {};
  const price = modules?.price || {};
  const unwrap = value => value && typeof value === 'object' && 'raw' in value ? value.raw : value ?? null;
  res.set('Cache-Control', 'no-store').json({
    success: Boolean(chart), source: 'Yahoo Finance (unofficial)', symbol,
    requestedAt: new Date().toISOString(),
    indicators: {
      sma50: quote?.fiftyDayAverage ?? unwrap(detail.fiftyDayAverage),
      sma200: quote?.twoHundredDayAverage ?? unwrap(detail.twoHundredDayAverage),
      sma50Source: quote?.fiftyDayAverage != null ? 'quote' : detail.fiftyDayAverage != null ? 'summaryDetail' : null,
      sma200Source: quote?.twoHundredDayAverage != null ? 'quote' : detail.twoHundredDayAverage != null ? 'summaryDetail' : null
    },
    price: {
      current: quote?.regularMarketPrice ?? unwrap(price.regularMarketPrice) ?? chart?.meta?.regularMarketPrice ?? null,
      previousClose: quote?.regularMarketPreviousClose ?? chart?.meta?.chartPreviousClose ?? null,
      currency: quote?.currency ?? chart?.meta?.currency ?? null,
      exchange: quote?.fullExchangeName ?? chart?.meta?.exchangeName ?? null,
      marketTime: quote?.regularMarketTime ?? chart?.meta?.regularMarketTime ?? null,
      change: quote?.regularMarketChange ?? null,
      changePercent: quote?.regularMarketChangePercent ?? null,
      high52Week: quote?.fiftyTwoWeekHigh ?? unwrap(detail.fiftyTwoWeekHigh),
      low52Week: quote?.fiftyTwoWeekLow ?? unwrap(detail.fiftyTwoWeekLow),
      volume: quote?.regularMarketVolume ?? null,
      averageVolume: quote?.averageDailyVolume3Month ?? unwrap(detail.averageVolume)
    },
    history: chart ? { meta: chart.meta, timestamps: chart.timestamp || [], indicators: chart.indicators, events: chart.events || {} } : null,
    raw, errors: Object.fromEntries(Object.entries(raw).filter(([, v]) => v?.error || v?.chart?.error || v?.quoteSummary?.error).map(([k,v])=>[k,v.error || v.chart?.error || v.quoteSummary?.error]))
  });
});

const { sequelize } = require('../config/database');
const ETF = require('../models/ETF');
const IMPORT_ISIN = 'IE00BL25JP72';
const IMPORT_SYMBOL = 'XDEM.DE';
const localDate = seconds => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(new Date(seconds * 1000));
const validPrice = value => typeof value === 'number' && Number.isFinite(value) && value > 0;

// Historical import: inserts missing dates only, preserving all existing prices.
router.post('/import-xdem', async (req, res) => {
  try {
    const etf = await ETF.findOne({ where: { isin: IMPORT_ISIN }, attributes: ['isin'], raw: true });
    if (!etf) return res.status(404).json({ success: false, error: 'ISIN ' + IMPORT_ISIN + ' assente in anagrafica_etf' });
    const response = await yahoo('/v8/finance/chart/' + IMPORT_SYMBOL + '?range=2y&interval=1d');
    if (response.error) return res.status(502).json({ success: false, error: 'Yahoo Finance unavailable', details: response.error });
    const chart = response.chart?.result?.[0];
    if (!chart || chart.meta?.symbol !== IMPORT_SYMBOL || chart.meta?.currency !== 'EUR') {
      return res.status(502).json({ success: false, error: 'Ticker o valuta Yahoo non coerenti' });
    }
    const timestamps = chart.timestamp || [];
    const quotes = chart.indicators?.quote?.[0] || {};
    const now = Math.floor(Date.now() / 1000);
    const today = localDate(now);
    const end = chart.meta?.currentTradingPeriod?.regular?.end;
    const sessionOpen = !Number.isFinite(end) || now < end;
    const prices = new Map();
    let skipped = 0;
    for (let i = 0; i < timestamps.length; i++) {
      const timestamp = timestamps[i];
      if (!Number.isFinite(timestamp) || timestamp > now) { skipped++; continue; }
      const date = localDate(timestamp);
      const unfinished = date === today && sessionOpen;
      const close = quotes.close?.[i];
      const opening = quotes.open?.[i];
      const current = chart.meta?.regularMarketPrice;
      const price = unfinished ? (validPrice(current) ? current : opening) : close;
      if (!validPrice(price)) { skipped++; continue; }
      prices.set(date, { date, quotation: price });
    }
    const rows = [...prices.values()];
    if (!rows.length) return res.json({ success: true, isin: IMPORT_ISIN, symbol: IMPORT_SYMBOL, received: timestamps.length, eligible: 0, inserted: 0, existing: 0, skipped });
    const [inserted] = await sequelize.query(`
      INSERT INTO etf_quotations (id, isin, date, quotation, source, "createdAt", "updatedAt")
      SELECT gen_random_uuid(), :isin, r.date, r.quotation, 'yahoo_chart', NOW(), NOW()
      FROM jsonb_to_recordset(CAST(:rows AS jsonb)) AS r(date date, quotation numeric)
      ON CONFLICT (isin, date) DO NOTHING
      RETURNING date
    `, { replacements: { isin: IMPORT_ISIN, rows: JSON.stringify(rows) } });
    return res.set('Cache-Control', 'no-store').json({
      success: true, isin: IMPORT_ISIN, symbol: IMPORT_SYMBOL,
      received: timestamps.length, eligible: rows.length, inserted: inserted.length,
      existing: rows.length - inserted.length, skipped, sessionOpen
    });
  } catch (error) {
    console.error('[Yahoo Finance historical import]', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
