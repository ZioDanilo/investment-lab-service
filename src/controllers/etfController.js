const ETF = require('../models/ETF');
const EtfCorrelation = require('../models/EtfCorrelation');
const EtfMacroStatistics = require('../models/EtfMacroStatistics');
const EtfQuotation = require('../models/EtfQuotation');
const PortafoglioEtf = require('../models/PortafoglioEtf');
const { sequelize } = require('../config/database');
const { fetchJustEtfProfile } = require('../utils/justetfScraper');

const GENERAL_SCENARIO = 'general';
const CORE_SCENARIOS = ['expansion', 'soft_landing', 'recession', 'stagflation'];

const toNumber = (value) => {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const deriveGeneralStatsPercent = (macroStats = []) => {
  const scenarioRows = macroStats.filter((row) => CORE_SCENARIOS.includes(row.macroScenario));
  if (scenarioRows.length === 0) {
    return null;
  }

  const average = (selector) => {
    const values = scenarioRows
      .map(selector)
      .map(toNumber)
      .filter((v) => v !== null);
    if (values.length === 0) {
      return null;
    }
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  };

  return {
    volatility: average((row) => row.volatility),
    maxDrawdown: average((row) => row.maxDrawdown),
    returnRangeMin: average((row) => row.returnRangeMin),
    returnRangeMax: average((row) => row.returnRangeMax)
  };
};


exports.getETFs = async (req, res, next) => {
  try {
    const etfs = await ETF.findAll({
      include: [
        {
          model: EtfMacroStatistics,
          as: 'macroStats',
          required: false,
          attributes: ['macroScenario', 'expectedReturn', 'volatility', 'maxDrawdown', 'returnRangeMin', 'returnRangeMax', 'updatedAt']
        }
      ]
    });

    const etfsWithMacro = etfs.map(etf => {
      const plain = etf.toJSON();
      const msArray = plain.macroStats;

      if (Array.isArray(msArray) && msArray.length > 0) {
        plain.macroStatistics = {};
        for (const ms of msArray) {
          const scenarioKey = ms.macroScenario === 'soft_landing' ? 'softLanding' : ms.macroScenario;
          plain.macroStatistics[scenarioKey] = {
            expectedReturn: parseFloat(ms.expectedReturn) / 100,
            volatility: parseFloat(ms.volatility) / 100,
            maxDrawdown: parseFloat(ms.maxDrawdown) / 100,
            returnRange: {
              min: parseFloat(ms.returnRangeMin) / 100,
              max: parseFloat(ms.returnRangeMax) / 100
            }
          };
        }

        const general = msArray.find((ms) => ms.macroScenario === GENERAL_SCENARIO);
        if (general) {
          const longTerm = toNumber(general.expectedReturn);
          if (longTerm !== null) {
            // Backward-compatible field, now sourced from etf_macro_statistics.general
            plain.longTermExpectedReturn = longTerm / 100;
          }
          if (general.updatedAt) {
            plain.calibratedAt = general.updatedAt;
          }
        }
      }

      delete plain.macroStats;
      return plain;
    });

    res.status(200).json({
      success: true,
      data: etfsWithMacro
    });
  } catch (error) {
    next(error);
  }
};

exports.getETFsSimple = async (req, res, next) => {
  try {
    const etfs = await ETF.findAll({
      attributes: ['id', 'isin', 'name', 'description']
    });
    res.status(200).json({
      success: true,
      data: etfs
    });
  } catch (error) {
    next(error);
  }
};

exports.getETFById = async (req, res, next) => {
  try {
    const etf = await ETF.findByPk(req.params.id);
    if (!etf) {
      return res.status(404).json({
        error: 'ETF not found'
      });
    }
    res.status(200).json({
      success: true,
      data: etf
    });
  } catch (error) {
    next(error);
  }
};

exports.createETF = async (req, res, next) => {
  try {
    const { name, nickname, ticker, description, assetClass, expense } = req.body;

    const etf = await ETF.create({
      name,
      nickname,
      ticker,
      description,
      assetClass,
      expense
    });

    res.status(201).json({
      success: true,
      data: etf
    });
  } catch (error) {
    next(error);
  }
};

exports.updateETF = async (req, res, next) => {
  try {
    const etf = await ETF.findByPk(req.params.id);

    if (!etf) {
      return res.status(404).json({
        error: 'ETF not found'
      });
    }

    await etf.update(req.body);

    res.status(200).json({
      success: true,
      data: etf
    });
  } catch (error) {
    next(error);
  }
};

exports.searchOnJustETF = async (req, res, next) => {
  try {
    const { isin } = req.query;

    if (!isin) {
      return res.status(400).json({
        success: false,
        error: 'ISIN is required'
      });
    }

    const result = await fetchJustEtfProfile(isin.trim().toUpperCase());

    if (!result) {
      return res.status(404).json({
        success: false,
        error: 'ETF not found on JustETF'
      });
    }

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
};

exports.addEtfWithCorrelations = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const { isin, descrizione, nome, nickname, ticker, quotation, correlations, macro_statistics, general_stats } = req.body;

    if (!isin || !descrizione) {
      await t.rollback();
      return res.status(400).json({ success: false, error: 'ISIN e Descrizione sono obbligatori' });
    }

    if (!macro_statistics || typeof macro_statistics !== 'object') {
      await t.rollback();
      return res.status(400).json({ success: false, error: 'macro_statistics è obbligatorio' });
    }

    const isinTrimmed = isin.trim().toUpperCase();
    const descrizioneTrimmed = descrizione.trim();
    const nomeTrimmed = nome ? nome.trim() : descrizioneTrimmed;
    const nicknameTrimmed = nickname ? nickname.trim() : null;
    const tickerTrimmed = ticker ? ticker.trim().toUpperCase() : null;

    const existing = await ETF.findOne({ where: { isin: isinTrimmed }, transaction: t });
    if (existing) {
      await t.rollback();
      return res.status(409).json({ success: false, error: 'ETF già censito' });
    }

    const existingEtfCount = await ETF.count({ transaction: t });

    if (!Array.isArray(correlations)) {
      await t.rollback();
      return res.status(400).json({ success: false, error: 'correlations array è obbligatorio' });
    }

    // Rule: correlations.length must equal number of ETFs already registered BEFORE this insertion
    if (correlations.length !== existingEtfCount) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        error: `Numero di correlazioni errato. ETF censiti prima: ${existingEtfCount}, correlazioni fornite: ${correlations.length}. Devono essere uguali.`,
        expectedCorrelations: existingEtfCount,
        providedCorrelations: correlations.length
      });
    }

    // Step 1: Insert ETF
    const newEtf = await ETF.create({
      isin: isinTrimmed,
      description: descrizioneTrimmed,
      name: nomeTrimmed,
      nickname: nicknameTrimmed,
      ticker: tickerTrimmed
    }, { transaction: t });

    // Step 2: Insert correlations
    const records = correlations.map(c => ({
      isin1: isinTrimmed,
      isin2: c.target_isin.trim().toUpperCase(),
      expansion: parseFloat(c.expansion),
      recession: parseFloat(c.recession),
      stagflation: parseFloat(c.stagflation),
      soft_landing: parseFloat(c.soft_landing)
    }));

    await EtfCorrelation.bulkCreate(records, {
      transaction: t,
      updateOnDuplicate: ['expansion', 'recession', 'stagflation', 'soft_landing', 'updatedAt']
    });

    // Step 3: Insert macro statistics (NEW NORMALIZED SCHEMA)
    // Each ETF has 4 records (one per scenario)
    const scenarios = ['expansion', 'soft_landing', 'recession', 'stagflation'];
    const macroRecords = scenarios.map(scenario => {
      const stats = macro_statistics[scenario];
      if (!stats) {
        throw new Error(`Macro statistics mancano per scenario: ${scenario}`);
      }

      return {
        isin: isinTrimmed,
        macroScenario: scenario,
        expectedReturn: parseFloat(stats.expected_return) * 100,
        volatility: parseFloat(stats.volatility) * 100,
        maxDrawdown: parseFloat(stats.max_drawdown) * 100,
        returnRangeMin: parseFloat(stats.return_range?.min) * 100,
        returnRangeMax: parseFloat(stats.return_range?.max) * 100
      };
    });

    // Validate all values are numbers
    for (const record of macroRecords) {
      const values = Object.values(record).slice(2); // Skip isin and macroScenario
      if (values.some(value => Number.isNaN(value))) {
        await t.rollback();
        return res.status(400).json({
          success: false,
          error: `macro_statistics contiene valori non validi per scenario ${record.macroScenario}`
        });
      }
    }

    // Bulk insert all 4 records
    await EtfMacroStatistics.bulkCreate(macroRecords, {
      transaction: t
    });

    // Step 3b: Insert 'general' macro record if provided
    if (general_stats && typeof general_stats === 'object') {
      const generalRecord = {
        isin: isinTrimmed,
        macroScenario: 'general',
        expectedReturn: parseFloat(general_stats.long_term_expected_return) * 100,
        volatility: parseFloat(general_stats.volatility) * 100,
        maxDrawdown: parseFloat(general_stats.max_drawdown) * 100,
        returnRangeMin: parseFloat(general_stats.return_range?.min) * 100,
        returnRangeMax: parseFloat(general_stats.return_range?.max) * 100
      };
      const generalValues = Object.values(generalRecord).slice(2);
      if (!generalValues.some(value => Number.isNaN(value))) {
        await EtfMacroStatistics.create(generalRecord, { transaction: t });
      }
    }

    // Step 4: Save quotation if provided
    if (quotation && !isNaN(parseFloat(quotation))) {
      const today = new Date().toISOString().split('T')[0];
      await EtfQuotation.upsert({
        isin: isinTrimmed,
        quotation: parseFloat(quotation),
        date: today
      }, {
        transaction: t,
        conflictFields: ['isin', 'date']
      });
      console.log(`   ✓ Quotation saved: ${isinTrimmed} = €${quotation} (${today})`);
    }

    await t.commit();

    res.status(201).json({
      success: true,
      message: `ETF aggiunto, ${records.length} correlazioni salvate e statistiche macro registrate`,
      data: { 
        etf: {
          id: newEtf.id,
          isin: newEtf.isin,
          name: newEtf.name,
          nickname: newEtf.nickname,
          description: newEtf.description,
          ticker: newEtf.ticker
        },
        correlationsCount: records.length, 
        macroStatisticsSaved: true 
      }
    });
  } catch (error) {
    await t.rollback();
    
    // Log error for debugging
    console.error('Error in addEtfWithCorrelations:', error.message);
    
    // Sequelize ValidationError has error.errors[] with details
    if (error.name === 'SequelizeValidationError' || error.name === 'SequelizeUniqueConstraintError') {
      const details = (error.errors || []).map(e => `${e.path}: ${e.message}`).join('; ');
      console.error('Sequelize validation details:', details);
      return res.status(400).json({
        success: false,
        error: `Validation error: ${details || error.message}`,
        details: (error.errors || []).map(e => ({ field: e.path, message: e.message, value: e.value }))
      });
    }
    
    // Return structured error response
    if (error.message && typeof error.message === 'string') {
      res.status(400).json({
        success: false,
        error: error.message
      });
    } else {
      next(error);
    }
  }
};

exports.addEtf = async (req, res, next) => {
  try {
    const { isin, descrizione, nickname } = req.body;

    // Validation
    if (!isin || !descrizione) {
      return res.status(400).json({
        success: false,
        error: 'ISIN e Descrizione sono obbligatori'
      });
    }

    const isinTrimmed = isin.trim().toUpperCase();
    const descrizioneTrimmed = descrizione.trim();
    const nicknameTrimmed = nickname ? nickname.trim() : null;

    // Check if ETF with this ISIN already exists
    const existingEtf = await ETF.findOne({
      where: { isin: isinTrimmed }
    });

    if (existingEtf) {
      return res.status(409).json({
        success: false,
        error: 'ETF già censito',
        data: existingEtf
      });
    }

    // Create new ETF record
    const newEtf = await ETF.create({
      isin: isinTrimmed,
      description: descrizioneTrimmed,
      name: descrizioneTrimmed,
      nickname: nicknameTrimmed,
      ticker: isinTrimmed
    });

    res.status(201).json({
      success: true,
      message: `Aggiunto ETF ${descrizioneTrimmed}`,
      data: newEtf
    });
  } catch (error) {
    next(error);
  }
};

// Calibrate a single ETF
// Endpoint: POST /api/etf/:isin/calibrate
// Body: { longTermExpectedReturn: 0.08 }
exports.calibrateETF = async (req, res, next) => {
  try {
    const { isin } = req.params;
    const { longTermExpectedReturn } = req.body;

    // Validation
    if (!isin || typeof longTermExpectedReturn !== 'number' || longTermExpectedReturn <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request: ISIN and valid longTermExpectedReturn required'
      });
    }

    const normalizedIsin = isin.toUpperCase();

    // Find ETF with macro statistics
    const etf = await ETF.findOne({
      where: { isin: normalizedIsin },
      include: [{
        model: EtfMacroStatistics,
        as: 'macroStats'
      }]
    });

    if (!etf) {
      return res.status(404).json({
        success: false,
        error: `ETF ${isin} not found`
      });
    }

    const macroStats = Array.isArray(etf.macroStats) ? etf.macroStats : [];
    if (macroStats.length === 0) {
      return res.status(400).json({
        success: false,
        error: `ETF ${isin} has no macro statistics data`
      });
    }

    const existingGeneral = macroStats.find((row) => row.macroScenario === GENERAL_SCENARIO) || null;
    const derived = deriveGeneralStatsPercent(macroStats);

    const fallbackVolatility = toNumber(existingGeneral?.volatility) ?? derived?.volatility;
    const fallbackMaxDrawdown = toNumber(existingGeneral?.maxDrawdown) ?? derived?.maxDrawdown;
    const fallbackRangeMin = toNumber(existingGeneral?.returnRangeMin) ?? derived?.returnRangeMin;
    const fallbackRangeMax = toNumber(existingGeneral?.returnRangeMax) ?? derived?.returnRangeMax;

    if ([fallbackVolatility, fallbackMaxDrawdown, fallbackRangeMin, fallbackRangeMax].some((v) => v === null)) {
      return res.status(400).json({
        success: false,
        error: `ETF ${isin} missing baseline statistics to build general scenario`
      });
    }

    await EtfMacroStatistics.upsert({
      isin: normalizedIsin,
      macroScenario: GENERAL_SCENARIO,
      expectedReturn: longTermExpectedReturn * 100,
      volatility: fallbackVolatility,
      maxDrawdown: fallbackMaxDrawdown,
      returnRangeMin: fallbackRangeMin,
      returnRangeMax: fallbackRangeMax
    });

    const savedGeneral = await EtfMacroStatistics.findOne({
      where: { isin: normalizedIsin, macroScenario: GENERAL_SCENARIO }
    });

    console.log(`✅ Calibration marked for ETF ${isin}`);
    console.log(`   longTermExpectedReturn: ${(longTermExpectedReturn * 100).toFixed(2)}%`);

    res.status(200).json({
      success: true,
      message: `ETF ${isin} calibration parameters updated`,
      data: {
        isin: etf.isin,
        name: etf.name,
        longTermExpectedReturn,
        calibratedAt: savedGeneral?.updatedAt || null
      }
    });

  } catch (error) {
    console.error('Error in calibrateETF:', error.message);
    next(error);
  }
};

// Get all ETFs (for displaying in quotations page)
exports.getAllEtfs = async (req, res, next) => {
  try {
    const etfs = await ETF.findAll({
      attributes: ['id', 'isin', 'name', 'nickname', 'ticker', 'description'],
      order: [['name', 'ASC']]
    });

    // Prevent stale 304 responses from hiding recent nickname updates in clients.
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');

    res.status(200).json({
      success: true,
      data: etfs,
      count: etfs.length
    });
  } catch (error) {
    next(error);
  }
};

// Delete ETF and all related data (only if not in any portfolio)
exports.deleteEtf = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const isin = (req.params.isin || '').trim().toUpperCase();
    if (!isin) {
      await t.rollback();
      return res.status(400).json({ success: false, error: 'ISIN obbligatorio' });
    }

    const etf = await ETF.findOne({ where: { isin }, transaction: t });
    if (!etf) {
      await t.rollback();
      return res.status(404).json({ success: false, error: `ETF ${isin} non trovato` });
    }

    // Block deletion if ETF is used in any portfolio
    const usageCount = await PortafoglioEtf.count({ where: { etfId: etf.id }, transaction: t });
    if (usageCount > 0) {
      await t.rollback();
      return res.status(409).json({
        success: false,
        error: `L'ETF ${isin} è presente in ${usageCount} portafoglio/i e non può essere eliminato`
      });
    }

    // Delete from all related tables
    await EtfMacroStatistics.destroy({ where: { isin }, transaction: t });
    await EtfCorrelation.destroy({ where: { isin1: isin }, transaction: t });
    await EtfCorrelation.destroy({ where: { isin2: isin }, transaction: t });
    await EtfQuotation.destroy({ where: { isin }, transaction: t });
    await etf.destroy({ transaction: t });

    await t.commit();
    res.status(200).json({ success: true, message: `ETF ${isin} eliminato con successo` });
  } catch (error) {
    await t.rollback();
    next(error);
  }
};
