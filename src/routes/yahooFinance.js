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

const localDate = (seconds, timeZone = 'Europe/Berlin') => {
  const parts = new Intl.DateTimeFormat('en-GB', {timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(seconds*1000));
  const p = Object.fromEntries(parts.map(x=>[x.type,x.value]));
  return p.year + '-' + p.month + '-' + p.day;
};
const validPrice = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
// Reject extreme price-scale anomalies before writing historical quotes.
const median = values => {
  const sorted = values.filter(validPrice).sort((a,b) => a-b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length/2);
  return sorted.length%2 ? sorted[mid] : (sorted[mid-1]+sorted[mid])/2;
};
const extremeRatio = (price, reference) => validPrice(price) && validPrice(reference) &&
  (price/reference > 3 || price/reference < 1/3);
const validateYahooRows = (rows, storedRows, splits = {}) => {
  const known = new Map(storedRows.filter(r => validPrice(Number(r.quotation)))
    .map(r => [String(r.date).slice(0,10), Number(r.quotation)]));
  const baseline = median([...known.values()]);
  const downloadBaseline = median(rows.map(r => r.quotation));
  const accepted = [], rejected = [];
  for (const row of rows) {
    const nearbyKnown = rows.filter(r => r.date !== row.date && known.has(r.date))
      .sort((a,b) => Math.abs(Date.parse(a.date)-Date.parse(row.date)) -
        Math.abs(Date.parse(b.date)-Date.parse(row.date)))
      .slice(0,10).map(r => known.get(r.date));
    const reference = median(nearbyKnown) ?? baseline ?? downloadBaseline;
    if (extremeRatio(row.quotation, reference)) {
      rejected.push({ date:row.date, quotation:row.quotation, reference,
        reason:'extreme_price_ratio_requires_review',
        possibleCorporateAction:Object.keys(splits).length > 0 });
    } else accepted.push(row);
  }
  return { accepted, rejected };
};
const resolveSymbol = etf => {
  const ticker = String(etf.ticker || '').trim().toUpperCase();
  const marketCode = String(etf.marketCode || '').trim().toUpperCase();
  if (!ticker || !allowed.test(ticker) || !/^[A-Z]{1,10}$/.test(marketCode)) return null;
  const suffix = '.' + marketCode;
  return ticker.endsWith(suffix) ? ticker : ticker.replace(/\\.[A-Z]{1,10}$/, '') + suffix;
};

router.post('/update-quotations', async (req, res) => {
  try {
    const now = Math.floor(Date.now() / 1000);
    const today = localDate(now);
    const etfs = await ETF.findAll({
      attributes: ['isin', 'ticker', 'marketCode'],
      raw: true
    });
    const [existingToday] = await sequelize.query(
      'SELECT isin FROM etf_quotations WHERE date = :today AND quotation IS NOT NULL',
      { replacements: { today } }
    );
    const covered = new Set(existingToday.map(row => row.isin));
    const missing = etfs; // Always request Yahoo on explicit refresh.
    const report = {
      success: true, date: today, totalEtfs: etfs.length, alreadyUpdatedToday: covered.size,
      toUpdate: missing.length, processed: 0, inserted: 0, updatedToday: 0, existing: 0, skippedPrices: 0,
      skippedMappings: [], failures: [], rejectedPrices: [], results: []
    };
    for (const etf of missing) {
      const symbol = resolveSymbol(etf);
      if (!symbol) {
        report.skippedMappings.push({ isin: etf.isin, ticker: etf.ticker, marketCode: etf.marketCode, reason: 'Ticker o market_code assente/non valido' });
        continue;
      }
      try {
        const response = await yahoo('/v8/finance/chart/' + encodeURIComponent(symbol) + '?range=2y&interval=1d&events=splits');
        if (response.error) throw new Error('Yahoo HTTP ' + response.error.status);
        const chart = response.chart?.result?.[0];
        if (!chart || chart.meta?.symbol?.toUpperCase() !== symbol) throw new Error('Risposta Yahoo non coerente con ' + symbol);
        const timestamps = chart.timestamp || [];
        const quotes = chart.indicators?.quote?.[0] || {};
        const zone = chart.meta?.exchangeTimezoneName || 'Europe/Berlin';
        const exchangeToday = localDate(now, zone);
        const marketEnd = chart.meta?.currentTradingPeriod?.regular?.end;
        const sessionUnfinished = !Number.isFinite(marketEnd) || now < marketEnd;
        const rowsByDate = new Map();
        let skipped = 0;
        for (let i = 0; i < timestamps.length; i++) {
          const timestamp = timestamps[i];
          if (!Number.isFinite(timestamp) || timestamp > now) { skipped++; continue; }
          const date = localDate(timestamp, zone);
          const unfinished = date === exchangeToday && sessionUnfinished;
          const close = quotes.close?.[i];
          const opening = quotes.open?.[i];
          const current = chart.meta?.regularMarketPrice;
          const quotation = unfinished ? (validPrice(current) ? current : opening) : close;
          if (!validPrice(quotation)) { skipped++; continue; }
          rowsByDate.set(date, { date, quotation });
        }
        const candidates = [...rowsByDate.values()].sort((a,b) => a.date.localeCompare(b.date));
        const [storedRows] = await sequelize.query(
          'SELECT date, quotation FROM etf_quotations WHERE isin = :isin AND quotation > 0 ORDER BY date',
          { replacements: { isin: etf.isin } }
        );
        const validation = validateYahooRows(candidates, storedRows, chart.events?.splits);
        const rows = validation.accepted;
        report.rejectedPrices.push(...validation.rejected.map(r => ({ isin:etf.isin, symbol, ...r })));
        if (validation.rejected.length) console.warn('[Yahoo quotations] quarantined', etf.isin, validation.rejected);
        let insertedCount = 0;
        if (rows.length) {
          const [inserted] = await sequelize.query(`
            INSERT INTO etf_quotations (id, isin, date, quotation, source, "createdAt", "updatedAt")
            SELECT gen_random_uuid(), :isin, r.date, r.quotation, 'yahoo_chart', NOW(), NOW()
            FROM jsonb_to_recordset(CAST(:rows AS jsonb)) AS r(date date, quotation numeric)
            ON CONFLICT (isin, date) DO UPDATE
            SET quotation = EXCLUDED.quotation, source = EXCLUDED.source, "updatedAt" = NOW()
            WHERE etf_quotations.date = :today
            RETURNING date, (xmax = 0) AS was_inserted
          `, { replacements: { isin: etf.isin, rows: JSON.stringify(rows), today: exchangeToday } });
          insertedCount = inserted.filter(row => row.was_inserted).length;
          report.updatedToday += inserted.length - insertedCount;
        }
        report.processed++;
        report.inserted += insertedCount;
        report.existing += rows.length - insertedCount - (report.updatedToday - (report._previousUpdatedToday || 0));
        report._previousUpdatedToday = report.updatedToday;
        report.skippedPrices += skipped;
        report.results.push({ isin: etf.isin, symbol, received: timestamps.length, inserted: insertedCount, existing: rows.length - insertedCount, skipped, rejected: validation.rejected.length });
      } catch (error) {
        report.failures.push({ isin: etf.isin, symbol, error: String(error.message || error) });
      }
    }
    delete report._previousUpdatedToday;
    return res.set('Cache-Control', 'no-store').json(report);
  } catch (error) {
    console.error('[Yahoo bulk quotations]', error);
    return res.status(500).json({ success: false, error: String(error.message || error) });
  }
});

module.exports = router;
