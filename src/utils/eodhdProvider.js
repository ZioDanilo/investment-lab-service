const axios = require('axios');

const BASE_URL = 'https://eodhd.com/api';

const getApiKey = () => {
  const apiKey = process.env.EODHD_API_KEY;
  if (!apiKey) throw new Error('EODHD_API_KEY is not configured');
  return apiKey;
};

const normalizeSearchResults = (data) => Array.isArray(data) ? data : [];

const chooseListing = (rows, isin) => {
  const exact = rows.filter((row) => String(row.ISIN || '').toUpperCase() === String(isin).toUpperCase());
  const etfs = exact.filter((row) => String(row.Type || '').toLowerCase().includes('etf'));
  const candidates = etfs.length ? etfs : exact;
  if (!candidates.length) return null;

  // ETFolio portfolios are EUR based: prefer a EUR listing, then its primary flag.
  // If EODHD has no EUR listing, prefer the primary listing and keep its currency.
  return [...candidates].sort((a, b) => {
    const aEur = String(a.Currency || '').toUpperCase() === 'EUR' ? 1 : 0;
    const bEur = String(b.Currency || '').toUpperCase() === 'EUR' ? 1 : 0;
    if (aEur !== bEur) return bEur - aEur;
    return Number(Boolean(b.isPrimary)) - Number(Boolean(a.isPrimary));
  })[0];
};

const resolveEodhdListing = async (etf) => {
  if (etf.eodhdCode && etf.eodhdExchange) {
    return {
      code: etf.eodhdCode,
      exchange: etf.eodhdExchange,
      currency: etf.eodhdCurrency || null
    };
  }

  const { data } = await axios.get(`${BASE_URL}/search/${encodeURIComponent(etf.isin)}`, {
    params: { api_token: getApiKey(), fmt: 'json', type: 'etf', limit: 50 },
    timeout: 10000
  });
  const listing = chooseListing(normalizeSearchResults(data), etf.isin);
  if (!listing?.Code || !listing?.Exchange) {
    throw new Error(`EODHD listing not found for ${etf.isin}`);
  }

  const resolved = {
    code: String(listing.Code),
    exchange: String(listing.Exchange),
    currency: listing.Currency ? String(listing.Currency).toUpperCase() : null
  };

  await etf.update({
    eodhdCode: resolved.code,
    eodhdExchange: resolved.exchange,
    eodhdCurrency: resolved.currency
  });
  return resolved;
};

const fetchEodhdQuotation = async (etf) => {
  const listing = await resolveEodhdListing(etf);
  const symbol = `${listing.code}.${listing.exchange}`;
  const { data } = await axios.get(`${BASE_URL}/real-time/${encodeURIComponent(symbol)}`, {
    params: { api_token: getApiKey(), fmt: 'json' },
    timeout: 10000
  });

  const price = Number(data?.close);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`EODHD returned no valid close for ${symbol}`);
  }
  return { price, symbol, currency: listing.currency, timestamp: data?.timestamp || null };
};

module.exports = { fetchEodhdQuotation, resolveEodhdListing };
