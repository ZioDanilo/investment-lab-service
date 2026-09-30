const Portfolio = require('../models/Portfolio');
const ETF = require('../models/ETF');
const EtfMacroStatistics = require('../models/EtfMacroStatistics');

// Helper to format normalized rows from etf_macro_statistics into nested object
const formatMacroStatistics = (msArray) => {
  if (!Array.isArray(msArray) || msArray.length === 0) return undefined;

  const result = {};
  for (const ms of msArray) {
    const scenario = ms.macroScenario;
    if (!scenario) continue;

    const scenarioKey = scenario === 'soft_landing' ? 'softLanding' : scenario;
    result[scenarioKey] = {
      expectedReturn: parseFloat(ms.expectedReturn) / 100,
      volatility: parseFloat(ms.volatility) / 100,
      maxDrawdown: parseFloat(ms.maxDrawdown) / 100,
      returnRange: {
        min: parseFloat(ms.returnRangeMin) / 100,
        max: parseFloat(ms.returnRangeMax) / 100
      }
    };
  }

  return result;
};

exports.getPortfolios = async (req, res, next) => {
  try {
    const portfolios = await Portfolio.findAll({
      where: { status: 'active', userId: req.user.id }
    });
    res.status(200).json({
      success: true,
      data: portfolios
    });
  } catch (error) {
    next(error);
  }
};

exports.getPortfolioById = async (req, res, next) => {
  try {
    const portfolio = await Portfolio.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!portfolio) {
      return res.status(404).json({
        error: 'Portfolio not found'
      });
    }

    const plain = portfolio.toJSON();

    // Enrich holdings with full ETF data including macro statistics
    if (plain.holdings && Array.isArray(plain.holdings) && plain.holdings.length > 0) {
      const isins = plain.holdings.map(h => h.isin || h.etfId).filter(Boolean);
      const etfsWithMacro = await ETF.findAll({
        where: { isin: isins },
        include: [{
          model: EtfMacroStatistics,
          as: 'macroStats',
          required: false
        }]
      });

      const etfMap = {};
      for (const etf of etfsWithMacro) {
        const e = etf.toJSON();
        etfMap[e.isin] = {
          ...e,
          macroStatistics: formatMacroStatistics(e.macroStats)
        };
        delete etfMap[e.isin].macroStats;
      }

      plain.holdings = plain.holdings.map(h => {
        const isin = h.isin || h.etfId;
        const etfData = etfMap[isin] || {};
        return {
          ...etfData,
          isin,
          weight: h.weight
        };
      });
    }

    res.status(200).json({
      success: true,
      data: plain
    });
  } catch (error) {
    next(error);
  }
};

exports.createPortfolio = async (req, res, next) => {
  try {
    const { name, description, holdings } = req.body;

    const portfolio = await Portfolio.create({
      name,
      description,
      holdings: holdings || [],
      userId: req.user.id
    });

    res.status(201).json({
      success: true,
      data: portfolio
    });
  } catch (error) {
    next(error);
  }
};

exports.updatePortfolio = async (req, res, next) => {
  try {
    const portfolio = await Portfolio.findOne({ where: { id: req.params.id, userId: req.user.id } });

    if (!portfolio) {
      return res.status(404).json({
        error: 'Portfolio not found'
      });
    }

    await portfolio.update(req.body);

    res.status(200).json({
      success: true,
      data: portfolio
    });
  } catch (error) {
    next(error);
  }
};

exports.deletePortfolio = async (req, res, next) => {
  try {
    const portfolio = await Portfolio.findOne({ where: { id: req.params.id, userId: req.user.id } });

    if (!portfolio) {
      return res.status(404).json({
        error: 'Portfolio not found'
      });
    }

    await portfolio.update({ status: 'archived' });

    res.status(200).json({
      success: true,
      message: 'Portfolio archived'
    });
  } catch (error) {
    next(error);
  }
};
