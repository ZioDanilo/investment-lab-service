const { Op } = require('sequelize');
const Factor = require('../models/Factor');
const FactorScenarioStatistic = require('../models/FactorScenarioStatistic');
const FactorCorrelation = require('../models/FactorCorrelation');
const EtfFactorExposure = require('../models/EtfFactorExposure');
const EtfSpecificRisk = require('../models/EtfSpecificRisk');
const EtfModelFit = require('../models/EtfModelFit');
const ETF = require('../models/ETF');

const SCENARIOS = ['general','expansion','soft_landing','recession','stagflation'];

const exposureWeightsForHistory = (years) => {
  const y = Number(years);
  if (!Number.isFinite(y) || y < 0) return { historicalWeight: 0.2, structuralWeight: 0.8 };
  if (y < 10) return { historicalWeight: 0.2, structuralWeight: 0.8 };
  if (y <= 20) return { historicalWeight: 0.6, structuralWeight: 0.4 };
  return { historicalWeight: 0.8, structuralWeight: 0.2 };
};

const canonicalPair = (factor1Id, factor2Id) =>
  String(factor1Id).localeCompare(String(factor2Id)) <= 0
    ? [factor1Id, factor2Id]
    : [factor2Id, factor1Id];

const assertScenario = (scenario) => {
  if (!SCENARIOS.includes(scenario)) {
    const error = new Error('Invalid macro scenario');
    error.statusCode = 400;
    throw error;
  }
};

class FactorEngineService {
  static exposureWeightsForHistory(years) { return exposureWeightsForHistory(years); }

  static async listFactors({ activeOnly = true } = {}) {
    return Factor.findAll({
      where: activeOnly ? { active: true } : undefined,
      order: [['sortOrder','ASC'],['family','ASC'],['name','ASC']]
    });
  }

  static async getScenarioSnapshot(scenario = 'general') {
    assertScenario(scenario);
    const factors = await Factor.findAll({ where: { active: true }, order: [['sortOrder','ASC'],['code','ASC']] });
    const factorIds = factors.map(f => f.id);
    const [statistics, correlations] = await Promise.all([
      FactorScenarioStatistic.findAll({ where: { factorId: { [Op.in]: factorIds }, macroScenario: scenario } }),
      FactorCorrelation.findAll({ where: { macroScenario: scenario, factor1Id: { [Op.in]: factorIds }, factor2Id: { [Op.in]: factorIds } } })
    ]);
    return { scenario, factors, statistics, correlations };
  }

  static async getEtfModel(etfId) {
    const etf = await ETF.findByPk(etfId);
    if (!etf) return null;
    const [exposures, specificRisk, latestFit] = await Promise.all([
      EtfFactorExposure.findAll({ where: { etfId }, include: [{ model: Factor, as: 'factor' }] }),
      EtfSpecificRisk.findOne({ where: { etfId } }),
      EtfModelFit.findOne({ where: { etfId }, order: [['createdAt','DESC']] })
    ]);
    return { etf, exposures, specificRisk, latestFit };
  }

  static async upsertExposure(etfId, factorId, payload) {
    const weights = exposureWeightsForHistory(payload.usableHistoryYears);
    const historicalWeight = payload.historicalWeight ?? weights.historicalWeight;
    const structuralWeight = payload.structuralWeight ?? weights.structuralWeight;
    const historicalBeta = payload.historicalBeta == null ? null : Number(payload.historicalBeta);
    const structuralBeta = payload.structuralBeta == null ? null : Number(payload.structuralBeta);
    let beta = payload.beta == null ? null : Number(payload.beta);
    if (beta == null && historicalBeta != null && structuralBeta != null) {
      beta = historicalBeta * historicalWeight + structuralBeta * structuralWeight;
    } else if (beta == null) {
      beta = historicalBeta ?? structuralBeta;
    }
    if (!Number.isFinite(beta)) {
      const error = new Error('A finite beta or enough components to derive it is required');
      error.statusCode = 400;
      throw error;
    }
    const values = {
      etfId, factorId, beta, historicalBeta, structuralBeta,
      historicalWeight, structuralWeight,
      usableHistoryYears: payload.usableHistoryYears ?? null,
      confidence: payload.confidence ?? null,
      provenance: payload.provenance ?? [],
      calibratedAt: payload.calibratedAt ?? new Date()
    };
    const [row] = await EtfFactorExposure.upsert(values, { returning: true });
    return row;
  }

  static async upsertCorrelation(payload) {
    assertScenario(payload.macroScenario);
    const [factor1Id, factor2Id] = canonicalPair(payload.factor1Id, payload.factor2Id);
    if (factor1Id === factor2Id) {
      const error = new Error('A factor cannot be correlated with itself in persisted pair data');
      error.statusCode = 400;
      throw error;
    }
    const corr = Number(payload.correlation);
    if (!Number.isFinite(corr) || corr < -1 || corr > 1) {
      const error = new Error('Correlation must be between -1 and 1');
      error.statusCode = 400;
      throw error;
    }
    const [row] = await FactorCorrelation.upsert({ ...payload, factor1Id, factor2Id, correlation: corr }, { returning: true });
    return row;
  }
}

module.exports = { FactorEngineService, SCENARIOS, exposureWeightsForHistory };
