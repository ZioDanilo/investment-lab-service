const { Op } = require('sequelize');
const ETF = require('../models/ETF');
const Factor = require('../models/Factor');
const FactorScenarioStatistic = require('../models/FactorScenarioStatistic');
const FactorCorrelation = require('../models/FactorCorrelation');
const EtfFactorExposure = require('../models/EtfFactorExposure');
const EtfSpecificRisk = require('../models/EtfSpecificRisk');
const EtfModelFit = require('../models/EtfModelFit');

const REQUIRED_SCENARIOS = ['general','expansion','soft_landing','recession','stagflation'];
const GENERATION_SCENARIOS = ['expansion','soft_landing','recession','stagflation'];

const finite = (value, label, details = {}) => {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    const error = new Error(`${label} must be finite`);
    error.code = 'INVALID_FACTOR_SNAPSHOT';
    error.statusCode = 422;
    error.details = details;
    throw error;
  }
  return n;
};

const pairKey = (a, b) => [String(a), String(b)].sort().join(':');

class FactorMarketUniverseSnapshotService {
  static async build({ etfIds = null } = {}) {
    const etfWhere = Array.isArray(etfIds) && etfIds.length ? { id: { [Op.in]: etfIds } } : undefined;
    const [etfs, factors] = await Promise.all([
      ETF.findAll({ where: etfWhere, raw: true }),
      Factor.findAll({ where: { active: true }, order: [['sortOrder','ASC'],['code','ASC']], raw: true })
    ]);
    if (!etfs.length) this.fail('FACTOR_UNIVERSE_EMPTY', 'No ETFs are available for Factor Engine V2');
    if (!factors.length) this.fail('FACTOR_CATALOG_EMPTY', 'No active factors are configured');

    const factorIds = factors.map(f => f.id);
    const ids = etfs.map(e => e.id);
    const [statistics, correlations, exposures, specificRisks, fits] = await Promise.all([
      FactorScenarioStatistic.findAll({ where: { factorId: { [Op.in]: factorIds } }, raw: true }),
      FactorCorrelation.findAll({ where: { factor1Id: { [Op.in]: factorIds }, factor2Id: { [Op.in]: factorIds } }, raw: true }),
      EtfFactorExposure.findAll({ where: { etfId: { [Op.in]: ids }, factorId: { [Op.in]: factorIds } }, raw: true }),
      EtfSpecificRisk.findAll({ where: { etfId: { [Op.in]: ids } }, raw: true }),
      EtfModelFit.findAll({ where: { etfId: { [Op.in]: ids } }, order: [['createdAt','DESC']], raw: true })
    ]);

    const statsByFactor = new Map();
    for (const row of statistics) {
      const map = statsByFactor.get(row.factorId) || new Map();
      if (map.has(row.macroScenario)) this.fail('DUPLICATE_FACTOR_SCENARIO', 'Duplicate factor scenario statistics', { factorId: row.factorId, scenario: row.macroScenario });
      map.set(row.macroScenario, {
        expectedReturn: finite(row.expectedReturn, 'expectedReturn', row),
        volatility: finite(row.volatility, 'volatility', row),
        confidence: row.confidence == null ? null : Number(row.confidence)
      });
      statsByFactor.set(row.factorId, map);
    }

    const factorPayload = factors.map(factor => {
      const byScenario = statsByFactor.get(factor.id) || new Map();
      const missing = REQUIRED_SCENARIOS.filter(s => !byScenario.has(s));
      if (missing.length) this.fail('MISSING_FACTOR_SCENARIO_STATISTICS', `Factor ${factor.code} is missing scenario statistics`, { factorId: factor.id, missing });
      return { ...factor, statistics: Object.fromEntries(byScenario) };
    });

    const corrByScenario = {};
    for (const scenario of GENERATION_SCENARIOS) corrByScenario[scenario] = {};
    for (const row of correlations) {
      if (!GENERATION_SCENARIOS.includes(row.macroScenario)) continue;
      corrByScenario[row.macroScenario][pairKey(row.factor1Id, row.factor2Id)] = finite(row.correlation, 'correlation', row);
    }
    for (const scenario of GENERATION_SCENARIOS) {
      for (let i=0; i<factorIds.length; i+=1) {
        for (let j=i+1; j<factorIds.length; j+=1) {
          const key = pairKey(factorIds[i], factorIds[j]);
          if (corrByScenario[scenario][key] == null) this.fail('MISSING_FACTOR_CORRELATION', 'Factor correlation matrix is incomplete', { scenario, factor1Id: factorIds[i], factor2Id: factorIds[j] });
        }
      }
    }

    const exposuresByEtf = new Map();
    for (const row of exposures) {
      const list = exposuresByEtf.get(row.etfId) || [];
      list.push({ factorId: row.factorId, beta: finite(row.beta, 'beta', row), confidence: row.confidence == null ? null : Number(row.confidence) });
      exposuresByEtf.set(row.etfId, list);
    }
    const riskByEtf = new Map(specificRisks.map(row => [row.etfId, row]));
    const latestFitByEtf = new Map();
    for (const fit of fits) if (!latestFitByEtf.has(fit.etfId)) latestFitByEtf.set(fit.etfId, fit);

    const etfPayload = etfs.map(etf => {
      const etfExposures = exposuresByEtf.get(etf.id) || [];
      const risk = riskByEtf.get(etf.id);
      const fit = latestFitByEtf.get(etf.id) || null;
      const ready = etfExposures.length > 0 && Boolean(risk) && fit?.status === 'ready';
      return {
        id: etf.id, isin: etf.isin, name: etf.name, indexId: etf.indexId || null,
        exposures: etfExposures,
        specificRisk: risk ? {
          annualizedVolatility: finite(risk.annualizedVolatility, 'annualizedVolatility', risk),
          residualVolatility: risk.residualVolatility == null ? null : Number(risk.residualVolatility),
          trackingError: risk.trackingError == null ? null : Number(risk.trackingError),
          alpha: finite(risk.alpha ?? 0, 'alpha', risk),
          fallbackUsed: Boolean(risk.fallbackUsed)
        } : null,
        validation: fit ? { status: fit.status, confidence: fit.confidence == null ? null : Number(fit.confidence), validatedAt: fit.validatedAt || null } : { status: 'pending' },
        ready
      };
    });

    return {
      version: 2,
      engine: 'factor',
      factorOrder: factors.map(f => f.id),
      factorCodes: factors.map(f => f.code),
      factors: factorPayload,
      correlations: corrByScenario,
      etfs: etfPayload,
      readyEtfCount: etfPayload.filter(e => e.ready).length,
      totalEtfCount: etfPayload.length,
      generatedAt: new Date().toISOString()
    };
  }

  static fail(code, message, details = {}) {
    const error = new Error(message);
    error.code = code;
    error.statusCode = 422;
    error.details = details;
    throw error;
  }
}

module.exports = { FactorMarketUniverseSnapshotService, REQUIRED_SCENARIOS, GENERATION_SCENARIOS };
