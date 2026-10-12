const ETF = require('../models/ETF');
const EtfQuotation = require('../models/EtfQuotation');
const Portafoglio = require('../models/Portafoglio');
const RealPortfolioEtf = require('../models/RealPortfolioEtf');
const { sequelize, Op } = require('../config/database');
const { fetchEodhdQuotation } = require('../utils/eodhdProvider');

// Helper function to get today's date in YYYY-MM-DD format
const getTodayDateString = () => {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
};

const getLatestStoredQuotation = async (isin) => {
  if (!isin) {
    return null;
  }

  return EtfQuotation.findOne({
    where: {
      isin,
      quotation: { [Op.ne]: null }
    },
    attributes: ['quotation', 'date'],
    order: [['date', 'DESC']],
    raw: true
  });
};

const isPlausibleQuotation = (quotation, previousQuotation) => {
  if (quotation === null || previousQuotation === null) {
    return true;
  }

  const currentValue = parseFloat(quotation);
  const previousValue = parseFloat(previousQuotation);
  if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue) || previousValue <= 0) {
    return true;
  }

  const ratio = currentValue / previousValue;
  return ratio >= 0.5 && ratio <= 1.5;
};

// Fetch one delayed live quotation from EODHD. The ISIN -> provider symbol mapping
// is resolved once and persisted on anagrafica_etf; subsequent days cost one provider
// call per ETF at most. Stored quotations are validated against the previous value.
const getQuotationFromEODHD = async (etf, requestDate = null) => {
  const report = async (status, details = {}) => {
    if (!requestDate) return;
    try {
      await ensureAttemptsTable();
      const [rows] = await sequelize.query(`
        UPDATE etf_quotation_fetch_attempts
        SET fetch_status = :status,
            provider_date = :providerDate,
            provider_price = :providerPrice,
            error_message = :errorMessage
        WHERE isin = :isin AND request_date = :requestDate
        RETURNING isin, fetch_status
      `, {
        replacements: {
          status,
          providerDate: details.quotationDate ?? null,
          providerPrice: details.price ?? null,
          errorMessage: details.error ?? null,
          isin: etf.isin,
          requestDate
        }
      });
      if (rows.length !== 1) {
        console.error(`[EODHD diagnostic] update affected ${rows.length} rows for ${etf.isin} on ${requestDate}`);
      } else {
        console.log(`[EODHD diagnostic] ${etf.isin} status=${status} providerDate=${details.quotationDate || '-'} providerPrice=${details.price ?? '-'}`);
      }
    } catch (diagnosticError) {
      console.error(`[EODHD diagnostic] persistence failed for ${etf.isin}: ${diagnosticError.message}`);
    }
  };
  if (!etf?.isin) return null;
  try {
    const { price, symbol, currency, quotationDate } = await fetchEodhdQuotation(etf);
    const lastStoredQuotation = await getLatestStoredQuotation(etf.isin);
    if (lastStoredQuotation && quotationDate < String(lastStoredQuotation.date)) {
      console.warn(`✗ Stale EODHD close for ${etf.isin}: marketDate=${quotationDate} < storedDate=${lastStoredQuotation.date}; retaining newer DB quotation`);
      await report('stale', { quotationDate, price });
      return null;
    }
    if (lastStoredQuotation && !isPlausibleQuotation(price, lastStoredQuotation.quotation)) {
      console.warn(`✗ Rejected suspicious EODHD price for ${etf.ticker} (${etf.isin}): ${price} vs last valid ${lastStoredQuotation.quotation} on ${lastStoredQuotation.date}`);
      await report('rejected_price', { quotationDate, price });
      return null;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(quotationDate || ''))) {
      console.warn(`✗ Missing EODHD market date for ${etf.isin}; skipping persistence`);
      await report('invalid_date', { price });
      return null;
    }
    console.log(`✓ EODHD ${etf.isin} [${symbol}, ${currency || 'n/a'}]: ${price} marketDate=${quotationDate}`);
    await report('received', { quotationDate, price });
    return { price, quotationDate };
  } catch (error) {
    console.warn(`✗ EODHD failed for ${etf.ticker} (${etf.isin}): ${error.response?.status || ''} ${error.message}`.trim());
    await report('error', { error: String(error.response?.status || error.message).slice(0, 250) });
    return null;
  }
};


// Provider request attempts are separate from market quotation dates.
// The unique (isin, request_date) key atomically reserves the daily quota
// before contacting EODHD, including unsuccessful requests.
let attemptsTableReady;
const ensureAttemptsTable = async () => {
  if (!attemptsTableReady) {
    attemptsTableReady = (async () => {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS etf_quotation_fetch_attempts (
        isin VARCHAR(255) NOT NULL,
        request_date DATE NOT NULL,
        attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        fetch_status VARCHAR(32),
        provider_date DATE,
        provider_price NUMERIC(15,4),
        error_message TEXT,
        PRIMARY KEY (isin, request_date)
      )`);
    await sequelize.query(`ALTER TABLE etf_quotation_fetch_attempts ADD COLUMN IF NOT EXISTS fetch_status VARCHAR(32), ADD COLUMN IF NOT EXISTS provider_date DATE, ADD COLUMN IF NOT EXISTS provider_price NUMERIC(15,4), ADD COLUMN IF NOT EXISTS error_message TEXT`);
    return true;
    })().catch(error => { attemptsTableReady = null; throw error; });
  }
  await attemptsTableReady;
};
const reserveDailyFetch = async (isin, today) => {
  await ensureAttemptsTable();
  const [rows] = await sequelize.query(`
    INSERT INTO etf_quotation_fetch_attempts (isin, request_date)
    VALUES (:isin, :today)
    ON CONFLICT (isin, request_date) DO NOTHING
    RETURNING isin
  `, { replacements: { isin, today } });
  return rows.length > 0;
};

// Daily cache is per ETF, not global: an ETF already stored today never calls EODHD again.
exports.getDailyQuotations = async (req, res, next) => {
  try {
    const today = getTodayDateString();
    const allEtfs = await ETF.findAll({
      attributes: ['id', 'isin', 'name', 'ticker', 'eodhdCode', 'eodhdExchange', 'eodhdCurrency']
    });
    if (!allEtfs.length) return res.status(200).json({ success: true, data: [], message: 'No ETFs found in database' });

    const todayRows = await EtfQuotation.findAll({
      where: { date: today, source: 'eodhd_eod', quotation: { [Op.ne]: null } },
      attributes: ['isin'], raw: true
    });
    const cached = new Set(todayRows.map((row) => row.isin));

    for (const etf of allEtfs) {
      if (cached.has(etf.isin) || !(await reserveDailyFetch(etf.isin, today))) continue;
      const quote = await getQuotationFromEODHD(etf, today);
      if (quote == null) continue;
      await EtfQuotation.upsert({ isin: etf.isin, quotation: quote.price, date: quote.quotationDate, source: 'eodhd_eod' }, { conflictFields: ['isin', 'date'] });
    }
    return await fetchQuotationsWithVariation(res, today);
  } catch (error) { next(error); }
};

// Helper to fetch quotations with variation calculation
// Falls back to most recent available quotation if today's is missing/null
const fetchQuotationsWithVariation = async (res, today) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');

    // Get all ETFs
    const etfDetails = await ETF.findAll({ attributes: ['isin', 'name'], raw: true });
    const isins = etfDetails.map(etf => etf.isin);

    if (isins.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        date: today
      });
    }

    const etfMap = {};
    etfDetails.forEach(etf => { etfMap[etf.isin] = etf.name; });

    // Get today's quotations (may be null or absent for some ETFs)
    const todayQuots = await EtfQuotation.findAll({
      where: { date: today, isin: { [Op.in]: isins }, source: 'eodhd_eod' },
      attributes: ['isin', 'quotation', 'date'],
      raw: true
    });
    const todayMap = new Map(todayQuots.map(q => [q.isin, q]));

    // Get all non-null quotations for involved ETFs once, ordered newest first.
    const nonNullQuotations = await EtfQuotation.findAll({
      where: {
        isin: { [Op.in]: isins },
        quotation: { [Op.ne]: null }
      },
      attributes: ['isin', 'quotation', 'date'],
      order: [['isin', 'ASC'], ['date', 'DESC']],
      raw: true
    });

    const quotesByIsin = new Map();
    for (const row of nonNullQuotations) {
      if (!quotesByIsin.has(row.isin)) {
        quotesByIsin.set(row.isin, []);
      }
      quotesByIsin.get(row.isin).push(row);
    }

    // For each ETF, use today's quotation if valid, otherwise fall back to last known
    const result = etfDetails.map((etf) => {
      const todayQ = todayMap.get(etf.isin);
      const isinQuotes = quotesByIsin.get(etf.isin) || [];

      let currentQ = (todayQ && todayQ.quotation != null) ? todayQ : (isinQuotes[0] || null);
      let sourceDate = currentQ?.date || null;

      if (!currentQ) {
        return { isin: etf.isin, name: etfMap[etf.isin] || etf.isin, quotation: null, variation: '-', date: null };
      }

      let variation = '-';
      const previousQ = isinQuotes.find((q) => q.date < sourceDate);
      if (previousQ) {
        const currentVal = parseFloat(currentQ.quotation);
        const previousVal = parseFloat(previousQ.quotation);
        if (!Number.isNaN(currentVal) && !Number.isNaN(previousVal) && previousVal !== 0) {
          const pct = ((currentVal - previousVal) / previousVal * 100).toFixed(2);
          variation = `${pct}%`;
        }
      }

      return {
        isin: etf.isin,
        name: etfMap[etf.isin] || etf.isin,
        quotation: parseFloat(currentQ.quotation),
        variation,
        date: sourceDate
      };
    });

    res.status(200).json({
      success: true,
      data: result,
      date: today
    });
  } catch (error) {
    throw error;
  }
};

// Get quotations history for a specific ETF
exports.getQuotationHistory = async (req, res, next) => {
  try {
    const { isin, limit = 30 } = req.query;

    if (!isin) {
      return res.status(400).json({
        success: false,
        error: 'ISIN parameter is required'
      });
    }

    const history = await EtfQuotation.findAll({
      where: { isin },
      attributes: ['isin', 'quotation', 'date'],
      order: [['date', 'DESC']],
      limit: parseInt(limit),
      raw: true
    });

    res.status(200).json({
      success: true,
      data: history
    });
  } catch (error) {
    next(error);
  }
};

// Delete today's quotations (for refresh)
exports.deleteTodayQuotations = async (req, res, next) => {
  try {
    const today = getTodayDateString();
    
    const result = await EtfQuotation.destroy({
      where: { date: today }
    });

    res.status(200).json({
      success: true,
      message: `Deleted ${result} quotations for today (${today})`,
      deletedCount: result
    });
  } catch (error) {
    next(error);
  }
};

// Force refresh - Update ALL ETFs from EODHD, overwrite DB, show results
exports.forceRefreshQuotations = async (req, res, next) => {
  // Kept for API compatibility. Under the free EODHD plan a "force" refresh must
  // still honor the once-per-ETF/day cache, so delegate to the normal daily flow.
  return exports.getDailyQuotations(req, res, next);
};

// Single ETF refresh - Update quotation for ONE ETF only
exports.refreshSingleQuotation = async (req, res, next) => {
  try {
    const { isin } = req.query;

    if (!isin) {
      return res.status(400).json({
        success: false,
        error: 'ISIN parameter is required'
      });
    }

    const today = getTodayDateString();

    // Get ETF details
    const etf = await ETF.findOne({
      where: { isin },
      attributes: ['id', 'isin', 'name', 'ticker', 'eodhdCode', 'eodhdExchange', 'eodhdCurrency']
    });

    if (!etf) {
      return res.status(404).json({
        success: false,
        error: `ETF with ISIN ${isin} not found`
      });
    }

    const cachedToday = await EtfQuotation.findOne({
      where: { isin, date: today, source: 'eodhd_eod' },
      attributes: ['quotation', 'date'], raw: true
    });
    if (cachedToday?.quotation != null && Number.isFinite(Number(cachedToday.quotation))) {
      return res.status(200).json({
        success: true,
        data: { isin: etf.isin, name: etf.name, quotation: cachedToday.quotation != null ? Number(cachedToday.quotation) : null, variation: '-' },
        date: today,
        cached: true
      });
    }

    if (!(await reserveDailyFetch(etf.isin, today))) {
      return res.status(200).json({ success: true, data: { isin: etf.isin, name: etf.name, quotation: (await getLatestStoredQuotation(isin))?.quotation ?? null, variation: '-' }, date: today, cached: true });
    }

    console.log(`\n🔄 Refreshing single quotation for ${etf.ticker} (${isin})`);

    // Fetch from EODHD
    const quote = await getQuotationFromEODHD(etf);
    const quotation = quote?.price ?? null;

    // Never persist a failed provider response. A NULL quotation is not a cache entry.
    if (quotation != null) {
      await EtfQuotation.upsert({
        isin: etf.isin,
        date: quote.quotationDate,
        quotation,
        source: 'eodhd_eod'
      }, {
        conflictFields: ['isin', 'date']
      });
    }

    const latestStored = await getLatestStoredQuotation(isin);
    const effectiveQuotation = latestStored?.quotation != null ? Number(latestStored.quotation) : null;
    const status = quotation !== null ? `✓ €${quotation}` : '✗ ND';
    console.log(`   ${status}\n`);

    // Calculate variation
    let variation = '-';
    if (effectiveQuotation !== null && latestStored?.date) {
      const previousQuote = await EtfQuotation.findOne({
        where: {
          isin: isin,
          date: { [Op.lt]: latestStored.date },
          quotation: { [Op.ne]: null }
        },
        attributes: ['quotation'],
        order: [['date', 'DESC']],
        raw: true
      });

      if (previousQuote) {
        const variationPercent = ((effectiveQuotation - previousQuote.quotation) / previousQuote.quotation * 100).toFixed(2);
        variation = `${variationPercent}%`;
      }
    }

    res.status(200).json({
      success: true,
      data: {
        isin: etf.isin,
        name: etf.name,
        quotation: effectiveQuotation,
        date: latestStored?.date ?? null,
        variation: variation
      },
      date: today
    });
  } catch (error) {
    next(error);
  }
};


// Refresh only ETFs currently held by one real portfolio.
// Today's stored quotation wins: EODHD is called at most once per ETF/day.
exports.refreshRealPortfolioQuotations = async (req, res, next) => {
  try {
    const today = getTodayDateString();
    const portfolio = await Portafoglio.findOne({
      where: { id: req.params.portfolioId, userId: req.user.id, tipo: 'reale', status: 'open' }
    });
    if (!portfolio) return res.status(404).json({ success: false, error: 'Portafoglio reale non trovato' });

    const positions = await RealPortfolioEtf.findAll({
      where: { realPortfolioId: portfolio.id },
      include: [{ model: ETF, as: 'etf', attributes: ['id', 'isin', 'name', 'ticker', 'nickname', 'eodhdCode', 'eodhdExchange', 'eodhdCurrency'] }]
    });
    const etfs = positions.map((row) => row.etf).filter(Boolean);
    if (!etfs.length) return res.status(200).json({ success: true, data: [], date: today });

    const isins = etfs.map((etf) => etf.isin);
    const todayRows = await EtfQuotation.findAll({
      where: { date: today, isin: { [Op.in]: isins }, source: 'eodhd_eod' },
      attributes: ['isin', 'quotation', 'date'],
      raw: true
    });
    const todayMap = new Map(todayRows.map((row) => [row.isin, row]));

    const calledThisRequest = new Set();
    for (const etf of etfs) {
      const cachedToday = todayMap.get(etf.isin);
      // Only a valid EODHD quotation counts as today's cache hit.
      // A NULL row can be left behind by a failed/configuration attempt and
      // must not prevent a later retry once the provider is available again.
      if (cachedToday?.quotation != null && Number.isFinite(Number(cachedToday.quotation))) continue;
      if (!(await reserveDailyFetch(etf.isin, today))) continue;

      const quote = await getQuotationFromEODHD(etf);
      if (quote == null) {
        // Failed requests must not create/overwrite quotation rows. Keep the
        // previous stored value available to the portfolio and allow a retry.
        todayMap.delete(etf.isin);
        continue;
      }
      await EtfQuotation.upsert(
        { isin: etf.isin, quotation: quote.price, date: quote.quotationDate, source: 'eodhd_eod' },
        { conflictFields: ['isin', 'date'] }
      );
      todayMap.set(etf.isin, { isin: etf.isin, quotation: quote.price, date: quote.quotationDate });
    }

    await ensureAttemptsTable();
    const [attemptRows] = await sequelize.query(`
      SELECT isin, attempted_at, fetch_status, provider_date, provider_price, error_message
      FROM etf_quotation_fetch_attempts
      WHERE request_date = :today AND isin IN (:isins)
    `, { replacements: { today, isins } });
    const attemptMap = new Map(attemptRows.map((attempt) => [attempt.isin, attempt]));

    const result = [];
    for (const etf of etfs) {
      // Always return the newest stored market date, never a stale provider result.
      const row = await getLatestStoredQuotation(etf.isin);
      const attempt = attemptMap.get(etf.isin);
      const marketDate = row?.date ? String(row.date) : null;
      const quotationAgeDays = marketDate ? Math.max(0, Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(marketDate + 'T00:00:00Z')) / 86400000)) : null;
      result.push({
        isin: etf.isin, name: etf.name, nickname: etf.nickname, ticker: etf.ticker,
        quotation: row?.quotation != null ? Number(row.quotation) : null,
        date: marketDate,
        diagnostic: {
          provider: 'EODHD',
          symbol: etf.eodhdCode && etf.eodhdExchange ? `${etf.eodhdCode}.${etf.eodhdExchange}` : null,
          fetchStatus: attempt ? (attempt.fetch_status || 'attempt_recorded_outcome_unknown') : 'not_attempted_today',
          providerCalled: Boolean(attempt),
          providerCalledThisRequest: calledThisRequest.has(etf.isin),
          lastAttempt: attempt?.attempted_at ?? null,
          providerDate: attempt?.provider_date ?? null,
          providerPrice: attempt?.provider_price != null ? Number(attempt.provider_price) : null,
          error: attempt?.error_message ?? null,
          quotationAgeDays
        }
      });
    }
    res.status(200).json({ success: true, data: result, date: today });
  } catch (error) { next(error); }
};
