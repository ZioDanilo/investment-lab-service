const ETF = require('../models/ETF');
const EtfQuotation = require('../models/EtfQuotation');
const { sequelize, Op } = require('../config/database');
const { fetchJustEtfQuotation } = require('../utils/justetfScraper');

// Helper function to get today's date in YYYY-MM-DD format
const getTodayDateString = () => {
  const today = new Date();
  return today.toISOString().split('T')[0];
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

// Get quotation from JustETF ONLY - NO FALLBACK
const getQuotationFromJustETF = async (ticker, isin) => {
  if (!isin) {
    console.log(`No ISIN provided for ticker ${ticker}`);
    return null;
  }

  const price = await fetchJustEtfQuotation(isin);
  
  if (price !== null) {
    const lastStoredQuotation = await getLatestStoredQuotation(isin);
    if (lastStoredQuotation && !isPlausibleQuotation(price, lastStoredQuotation.quotation)) {
      console.warn(
        `✗ Rejected suspicious JustETF price for ${ticker} (${isin}): €${price} vs last valid €${lastStoredQuotation.quotation} on ${lastStoredQuotation.date}`
      );
      return null;
    }

    console.log(`✓ Using JustETF price for ${ticker} (${isin}): €${price}`);
    return price;
  }

  // NO FALLBACK - if JustETF fails, return null (will show as ND)
  console.log(`✗ JustETF failed for ${ticker} - will display ND`);
  return null;
};

// Get quotations from JustETF ONLY - NO FALLBACK CHAIN
// Returns price or null (which will display as "ND")
exports.getDailyQuotations = async (req, res, next) => {
  try {
    const today = getTodayDateString();
    
    // Check if quotations for today already exist
    const existingQuotations = await EtfQuotation.findAll({
      where: { date: today },
      attributes: ['isin', 'quotation', 'createdAt']
    });

    if (existingQuotations.length > 0) {
      // Quotations already exist for today - fetch them with variation
      return await fetchQuotationsWithVariation(res, today);
    }

    // Quotations don't exist for today - fetch from JustETF ONLY
    const allEtfs = await ETF.findAll({
      attributes: ['id', 'isin', 'name', 'ticker']
    });

    if (allEtfs.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        message: 'No ETFs found in database'
      });
    }

    console.log(`\n📊 Fetching quotations from JustETF for ${allEtfs.length} ETFs...`);
    
    // Fetch quotations from JustETF ONLY — only save if value is not null
    for (const etf of allEtfs) {
      console.log(`  → ${etf.name} (${etf.ticker})`);
      const quotation = await getQuotationFromJustETF(etf.ticker, etf.isin);
      
      // Only save to DB if we actually got a value (avoid overwriting history with null)
      if (quotation !== null) {
        await EtfQuotation.upsert({
          isin: etf.isin,
          quotation,
          date: today
        }, { conflictFields: ['isin', 'date'] });
        console.log(`    ✓ €${quotation}`);
      } else {
        console.log(`    ✗ ND (kept last known)`);
      }
    }

    console.log(`✓ JustETF fetch complete\n`);
    
    // Fetch and return with variation
    return await fetchQuotationsWithVariation(res, today);
  } catch (error) {
    next(error);
  }
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
      where: { date: today, isin: { [Op.in]: isins } },
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

// Force refresh - Update ALL ETFs from JustETF, overwrite DB, show results
exports.forceRefreshQuotations = async (req, res, next) => {
  try {
    const today = getTodayDateString();
    
    console.log(`\n🔄 FORCE REFRESH STARTED for date ${today}`);
    
    // Step 1: Delete today's quotations
    await EtfQuotation.destroy({
      where: { date: today }
    });
    console.log(`✓ Cleared old quotations for ${today}`);
    
    // Step 2: Get all ETFs
    const allEtfs = await ETF.findAll({
      attributes: ['id', 'isin', 'name', 'ticker']
    });

    if (allEtfs.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        message: 'No ETFs found in database'
      });
    }

    console.log(`📊 Found ${allEtfs.length} ETFs to refresh from JustETF`);
    
    // Step 3: Fetch quotations ONLY from JustETF for all ETFs
    const newQuotations = [];
    
    for (const etf of allEtfs) {
      console.log(`   → Fetching ${etf.ticker} (${etf.isin}): ${etf.name}`);
      
      // Force JustETF fetch ONLY
      const quotation = await getQuotationFromJustETF(etf.ticker, etf.isin);
      
      // Save to DB (null is allowed - means no data found)
      const quote = await EtfQuotation.create({
        isin: etf.isin,
        quotation: quotation, // Can be null
        date: today
      });
      
      const status = quotation !== null ? `✓ €${quotation}` : '✗ ND';
      console.log(`     ${status}`);
      
      newQuotations.push(quote);
    }

    console.log(`✓ FORCE REFRESH COMPLETED - ${newQuotations.length} ETFs updated\n`);
    
    // Step 4: Return updated quotations with variation
    return await fetchQuotationsWithVariation(res, today);
  } catch (error) {
    next(error);
  }
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
      attributes: ['id', 'isin', 'name', 'ticker']
    });

    if (!etf) {
      return res.status(404).json({
        success: false,
        error: `ETF with ISIN ${isin} not found`
      });
    }

    console.log(`\n🔄 Refreshing single quotation for ${etf.ticker} (${isin})`);

    // Fetch from JustETF
    const quotation = await getQuotationFromJustETF(etf.ticker, etf.isin);

    // Upsert quotation (update if exists, create if not)
    await EtfQuotation.upsert({
      isin: etf.isin,
      date: today,
      quotation: quotation
    }, {
      conflictFields: ['isin', 'date']
    });

    const status = quotation !== null ? `✓ €${quotation}` : '✗ ND';
    console.log(`   ${status}\n`);

    // Calculate variation
    let variation = '-';
    if (quotation !== null) {
      const previousQuote = await EtfQuotation.findOne({
        where: {
          isin: isin,
          date: { [Op.lt]: today }
        },
        attributes: ['quotation'],
        order: [['date', 'DESC']],
        raw: true
      });

      if (previousQuote) {
        const variationPercent = ((quotation - previousQuote.quotation) / previousQuote.quotation * 100).toFixed(2);
        variation = `${variationPercent}%`;
      }
    }

    res.status(200).json({
      success: true,
      data: {
        isin: etf.isin,
        name: etf.name,
        quotation: quotation !== null ? parseFloat(quotation) : null,
        variation: variation
      },
      date: today
    });
  } catch (error) {
    next(error);
  }
};
