const StructuralProbability = require('../models/StructuralProbability');
const TransitionMatrix = require('../models/TransitionMatrix');
const ETF = require('../models/ETF');
const EtfMacroStatistics = require('../models/EtfMacroStatistics');
const EtfCorrelation = require('../models/EtfCorrelation');
const ScenarioInertiaConfiguration = require('../models/ScenarioInertiaConfiguration');
const ScenarioIntensityConfiguration = require('../models/ScenarioIntensityConfiguration');
const MonteCarloGlobalProperty = require('../models/MonteCarloGlobalProperty');
const { Op } = require('../config/database');
const { buildMonteCarloSnapshot } = require('../utils/monteCarloSnapshot');

const CONFIG_CACHE_TTL_MS = 5 * 60 * 1000;
const SNAPSHOT_CACHE_TTL_MS = 5 * 60 * 1000;
const configCache = new Map();
const snapshotCache = new Map();

const getCacheEntry = (cache, key, ttlMs) => {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > ttlMs) {
    cache.delete(key);
    return null;
  }
  return entry.value;
};

const setCacheEntry = (cache, key, value) => {
  cache.set(key, {
    value,
    timestamp: Date.now()
  });
};

const buildSnapshotCacheKey = (isins) => {
  const normalized = [...new Set(isins.map((isin) => String(isin).trim().toUpperCase()))].sort();
  return normalized.join('|');
};

const clearMonteCarloCaches = () => {
  configCache.clear();
  snapshotCache.clear();
};

/**
 * GET /api/monte-carlo/config
 * Retrieves all Monte Carlo configuration from database
 * Returns structural probabilities and transition matrix
 */
const getConfig = async (req, res, next) => {
  try {
    const cachedConfig = getCacheEntry(configCache, 'global-config', CONFIG_CACHE_TTL_MS);
    if (cachedConfig) {
      return res.status(200).json({
        success: true,
        data: cachedConfig
      });
    }

    // Fetch structural probabilities
    const structuralData = await StructuralProbability.findAll({
      attributes: ['scenario', 'probability'],
      raw: true,
      order: [['scenario', 'ASC']]
    });

    // Fetch transition matrix
    const transitionData = await TransitionMatrix.findAll({
      attributes: ['fromScenario', 'toScenario', 'probability'],
      raw: true,
      order: [['fromScenario', 'ASC'], ['toScenario', 'ASC']]
    });

    // Convert structural probabilities array to object
    const structuralProbabilities = {};
    structuralData.forEach(row => {
      structuralProbabilities[row.scenario] = parseFloat(row.probability);
    });

    // Convert transition matrix array to nested object
    // Format: { expansion: { expansion: 0.6, recession: 0.1, ... }, ... }
    const transitionMatrix = {};
    transitionData.forEach(row => {
      if (!transitionMatrix[row.fromScenario]) {
        transitionMatrix[row.fromScenario] = {};
      }
      transitionMatrix[row.fromScenario][row.toScenario] = parseFloat(row.probability);
    });

    // Validate that each from_scenario sums to ~1.0 (tolerance 0.001)
    const tolerance = 0.001;
    for (const fromScenario of Object.keys(transitionMatrix)) {
      const sum = Object.values(transitionMatrix[fromScenario]).reduce((a, b) => a + b, 0);
      if (Math.abs(sum - 1.0) > tolerance) {
        console.warn(
          `⚠️  Transition matrix from "${fromScenario}" sums to ${sum.toFixed(6)}, expected ~1.0`
        );
      }
    }

    const payload = {
      structuralProbabilities,
      transitionMatrix
    };

    setCacheEntry(configCache, 'global-config', payload);

    res.status(200).json({
      success: true,
      data: payload
    });
  } catch (error) {
    console.error('Error fetching Monte Carlo config:', error);
    next(error);
  }
};

/**
 * POST /api/monte-carlo/snapshot
 * Builds one complete, validated, decimal-formatted data snapshot for a run.
 * Target weights remain frontend input and are intentionally not accepted here.
 */
const getSnapshot = async (req, res, next) => {
  try {
    const { isins } = req.body;
    if (!Array.isArray(isins) || isins.length === 0 || isins.some((isin) => typeof isin !== 'string' || isin.trim() === '')) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_SNAPSHOT_REQUEST',
          message: 'isins must be a non-empty array of non-empty strings'
        }
      });
    }

    const normalizedIsins = [...new Set(isins.map((isin) => isin.trim().toUpperCase()))].sort();
    const cacheKey = buildSnapshotCacheKey(normalizedIsins);
    const cachedSnapshot = getCacheEntry(snapshotCache, cacheKey, SNAPSHOT_CACHE_TTL_MS);
    if (cachedSnapshot) {
      return res.status(200).json({ success: true, data: cachedSnapshot });
    }

    const [etfs, macroStatistics, structuralProbabilities, transitions, inertiaConfigurations, intensityConfigurations, globalProperties, correlations] = await Promise.all([
      ETF.findAll({ where: { isin: { [Op.in]: normalizedIsins } }, attributes: ['isin', 'name', 'nickname'], raw: true }),
      EtfMacroStatistics.findAll({ where: { isin: { [Op.in]: normalizedIsins } }, raw: true }),
      StructuralProbability.findAll({ attributes: ['scenario', 'probability'], raw: true }),
      TransitionMatrix.findAll({ attributes: ['fromScenario', 'toScenario', 'probability'], raw: true }),
      ScenarioInertiaConfiguration.findAll({ raw: true }),
      ScenarioIntensityConfiguration.findAll({ raw: true }),
      MonteCarloGlobalProperty.findAll({ attributes: ['propertyKey', 'value'], raw: true }),
      EtfCorrelation.findAll({
        where: {
          isin1: { [Op.in]: normalizedIsins },
          isin2: { [Op.in]: normalizedIsins }
        },
        raw: true
      })
    ]);

    const snapshot = buildMonteCarloSnapshot({
      isins: normalizedIsins,
      etfs,
      macroStatistics,
      structuralProbabilities,
      transitions,
      inertiaConfigurations,
      intensityConfigurations,
      globalProperties,
      correlations
    });

    setCacheEntry(snapshotCache, cacheKey, snapshot);

    return res.status(200).json({ success: true, data: snapshot });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getConfig,
  getSnapshot,
  clearMonteCarloCaches
};
