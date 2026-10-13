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

const { updateAll } = require('../services/yahooQuotationService');
router.post('/update-quotations', async(req,res)=>{
  try{
    const report=await updateAll({historical:true});
    return res.set('Cache-Control','no-store').json(report);
  }catch(error){
    console.error('[Yahoo bulk quotations]',error);
    return res.status(500).json({success:false,error:String(error.message||error)});
  }
});
module.exports=router;
