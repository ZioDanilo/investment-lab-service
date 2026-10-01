const { Op, Transaction } = require('sequelize');
const { sequelize, initializeAssociations } = require('../config/database');
initializeAssociations();
const ETF = require('../models/ETF');
const EtfMacroStatistics = require('../models/EtfMacroStatistics');
const EtfCorrelation = require('../models/EtfCorrelation');
const MarketUniverseRun = require('../models/MarketUniverseRun');
const MarketUniverseMonth = require('../models/MarketUniverseMonth');
const MarketUniverseBinaryChunk = require('../models/MarketUniverseBinaryChunk');
const { persistBinaryCache, loadBinaryCache } = require('./marketUniverseBinaryCache');
const { buildMonteCarloSnapshot } = require('../utils/monteCarloSnapshot');
const { encodeMarketUniverseBinary, PAYLOAD_TYPE_FULL, PAYLOAD_TYPE_RETURNS_ONLY } = require('../utils/marketUniverseBinaryTransport');

const optionalModel = (modulePath) => {
  try {
    return require(modulePath);
  } catch (error) {
    return null;
  }
};

const StructuralProbability = optionalModel('../models/StructuralProbability');
const TransitionMatrix = optionalModel('../models/TransitionMatrix');
const ScenarioInertiaConfiguration = optionalModel('../models/ScenarioInertiaConfiguration');
const ScenarioIntensityConfiguration = optionalModel('../models/ScenarioIntensityConfiguration');
const MonteCarloGlobalProperty = optionalModel('../models/MonteCarloGlobalProperty');

const SCENARIO_KEYS = ['expansion', 'soft_landing', 'recession', 'stagflation', 'general'];
const CORRELATION_SCENARIOS = ['expansion', 'soft_landing', 'recession', 'stagflation'];
const TRANSIENT_DB_ERROR_CODES = new Set([
  'ECONNRESET',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EPIPE',
  'CONNECTION_RESET',
  'CONNECTION_TIMEOUT',
  'timeout'
]);

const isTransientDbError = (error) => {
  if (!error) {
    return false;
  }

  const message = String(error.message || error.code || error || '');
  const code = String(error.code || '').toUpperCase();
  return TRANSIENT_DB_ERROR_CODES.has(code) || /ECONNRESET|ETIMEDOUT|timed out|connection.*reset|terminated unexpectedly|read ECONNRESET|connection lost/i.test(message);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toDecimalPercentCompatible = (value) => {
  const number = toNumber(value);
  if (number === null) {
    return null;
  }
  return Math.abs(number) <= 1.5 ? number : number / 100;
};

const normalizeScenarioStats = (row) => {
  const scenario = row && row.macroScenario;
  if (!scenario) {
    return {};
  }

  const stats = {
    expectedReturn: toDecimalPercentCompatible(row.expectedReturn),
    volatility: toDecimalPercentCompatible(row.volatility),
    maxDrawdown: toDecimalPercentCompatible(row.maxDrawdown) ?? undefined,
    returnRange: {
      min: toDecimalPercentCompatible(row.returnRangeMin),
      max: toDecimalPercentCompatible(row.returnRangeMax)
    }
  };

  if (row.maxDrawdown === null || row.maxDrawdown === undefined || row.maxDrawdown === '') {
    delete stats.maxDrawdown;
  }

  return { [scenario]: stats };
};

const normalizeLiveCorrelationMatrix = (correlations = []) => {
  if (!Array.isArray(correlations)) {
    return [];
  }

  return correlations.map((row) => ({ ...(row || {}) }));
};

const normalizeLegacyAsset = (etf, options = {}) => {
  const raw = { ...(etf || {}) };
  const macroStatsGrouped = Array.isArray(raw.macroStatistics) ? raw.macroStatistics : (Array.isArray(raw.macroStats) ? raw.macroStats : []);
  const aggregated = {};

  for (const row of macroStatsGrouped) {
    Object.assign(aggregated, normalizeScenarioStats(row));
  }

  const generalScenario = aggregated.general || {};
  const baseExpectedReturn = toDecimalPercentCompatible(raw.longTermExpectedReturn)
    ?? toDecimalPercentCompatible(generalScenario.expectedReturn)
    ?? toDecimalPercentCompatible(raw.expectedReturn)
    ?? null;
  const baseVolatility = toDecimalPercentCompatible(generalScenario.volatility)
    ?? toDecimalPercentCompatible(raw.volatility)
    ?? null;
  const baseMaxDrawdown = toDecimalPercentCompatible(generalScenario.maxDrawdown)
    ?? toDecimalPercentCompatible(raw.maxDrawdown)
    ?? null;
  const baseRangeMin = toDecimalPercentCompatible(generalScenario.returnRange && generalScenario.returnRange.min != null ? generalScenario.returnRange.min : raw.returnRangeMin)
    ?? null;
  const baseRangeMax = toDecimalPercentCompatible(generalScenario.returnRange && generalScenario.returnRange.max != null ? generalScenario.returnRange.max : raw.returnRangeMax)
    ?? null;

  return {
    id: raw.id || raw.isin || raw.ticker || 'unknown-asset',
    isin: raw.isin || '',
    ticker: raw.ticker || undefined,
    name: raw.name || raw.nickname || raw.isin || 'Unnamed asset',
    nickname: raw.nickname || undefined,
    description: raw.description || raw.mission || raw.name || undefined,
    assetClass: raw.assetClass || raw.compartment || undefined,
    subAssetClass: raw.subAssetClass || undefined,
    category: raw.category || raw.compartment || undefined,
    geography: raw.geography || undefined,
    currency: raw.currency || undefined,
    instrumentType: raw.instrumentType || undefined,
    provider: raw.provider || undefined,
    ter: toNumber(raw.expense) ?? toNumber(raw.ter) ?? null,
    distributing: raw.distributing ?? undefined,
    hedged: raw.hedged ?? undefined,
    expectedReturn: baseExpectedReturn !== null ? baseExpectedReturn : null,
    volatility: baseVolatility !== null ? baseVolatility : null,
    maxDrawdown: baseMaxDrawdown !== null ? baseMaxDrawdown : null,
    returnRangeMin: baseRangeMin !== null ? baseRangeMin : null,
    returnRangeMax: baseRangeMax !== null ? baseRangeMax : null,
    expansion: aggregated.expansion || null,
    soft_landing: aggregated.soft_landing || null,
    recession: aggregated.recession || null,
    stagflation: aggregated.stagflation || null,
    general: aggregated.general || null,
    legacyFallback: Boolean(options.legacyFallback),
    source: options.legacyFallback ? 'legacy-fallback' : 'backend',
    ...(options.legacyFallback ? { legacyFallback: true } : {})
  };
};

const loadSharedMonteCarloCore = async () => {
  const runtime = await import('investment-lab-core');

  return {
    derivePathSeed: runtime.derivePathSeed,
    createDeterministicRandom: runtime.createDeterministicRandom || null,
    generateMonthlyMacroTimeline: runtime.generateMonthlyMacroTimeline,
    generateMonthlyReturnVector: runtime.generateMonthlyReturnVector,
    prepareMonteCarloPrecomputation: runtime.prepareMonteCarloPrecomputation,
    SeededRandom: runtime.SeededRandom
  };
};

class MarketUniverseServiceClass {
  static activeUniverseCache = {
    runId: null,
    pathCount: 0,
    monthCount: 0,
    assetCount: 0,
    assetOrder: [],
    returns: null,
    scenarios: null,
    intensities: null,
    loadedAt: null,
    loadMs: 0,
    state: 'COLD'
  };

  static activeUniverseLoadPromise = null;

  static activeUniverseStats = {
    cacheHits: 0,
    cacheMisses: 0,
    dbLoads: 0,
    lastLoadMs: 0
  };

  static buildApproxCacheMemoryBytes(cache) {
    const standardHeader = 128;
    const scenarioBytes = cache?.scenarios ? cache.scenarios.length * 24 : 0;
    const intensityBytes = cache?.intensities ? cache.intensities.byteLength : 0;
    const returnsBytes = cache?.returns ? cache.returns.byteLength : 0;
    return standardHeader + returnsBytes + intensityBytes + scenarioBytes;
  }

  static invalidateActiveUniverseCache(runId = null) {
    const currentRunId = this.activeUniverseCache && this.activeUniverseCache.runId ? String(this.activeUniverseCache.runId) : null;
    if (runId && currentRunId && currentRunId !== String(runId)) {
      return this.activeUniverseCache;
    }

    this.activeUniverseCache = {
      runId: null,
      pathCount: 0,
      monthCount: 0,
      assetCount: 0,
      assetOrder: [],
      returns: null,
      scenarios: null,
      intensities: null,
      loadedAt: null,
      loadMs: 0,
      state: 'COLD'
    };
    this.activeUniverseLoadPromise = null;
    return this.activeUniverseCache;
  }

  static async getGenerationStatus() {
    const targetRecords = 360000;
    const totalRecords = Number(await MarketUniverseMonth.count());
    const currentRecords = Math.max(0, totalRecords - targetRecords);
    const inProgress = totalRecords !== targetRecords;

    if (!inProgress) {
      return { inProgress: false };
    }

    const missingRecords = Math.max(0, targetRecords - currentRecords);
    const progressPercentage = Math.max(0, Math.min(100, (currentRecords / targetRecords) * 100));

    return {
      inProgress: true,
      currentRecords,
      missingRecords,
      targetRecords,
      progressPercentage
    };
  }

  static async getActiveUniverseCacheStatus() {
    const activeRun = await this.getActiveMarketUniverseRun();
    const cache = this.activeUniverseCache;
    const state = cache.runId === activeRun.runId && cache.state === 'WARM' ? 'WARM' : (this.activeUniverseLoadPromise ? 'LOADING' : 'COLD');
    return {
      state,
      runId: cache.runId || activeRun.runId,
      loadedAt: cache.loadedAt || null,
      loadMs: Number(cache.loadMs || 0),
      pathCount: Number(cache.pathCount || activeRun.pathCount || 0),
      monthCount: Number(cache.monthCount || activeRun.monthCount || 0),
      assetCount: Number(cache.assetCount || activeRun.assetCount || 0),
      memoryBytes: this.buildApproxCacheMemoryBytes(cache),
      cacheHits: Number(this.activeUniverseStats.cacheHits || 0),
      cacheMisses: Number(this.activeUniverseStats.cacheMisses || 0),
      dbLoads: Number(this.activeUniverseStats.dbLoads || 0)
    };
  }

  static async warmupActiveUniverseCache() {
    const cache = await this.getActiveUniverseCache();
    return {
      runId: cache.runId,
      status: cache.state,
      loadMs: Number(cache.loadMs || 0),
      memoryBytes: this.buildApproxCacheMemoryBytes(cache),
      pathCount: Number(cache.pathCount || 0),
      monthCount: Number(cache.monthCount || 0),
      assetCount: Number(cache.assetCount || 0)
    };
  }

  static async promoteActiveUniverseCacheAfterActivation(previousRunId = null, nextRunId = null) {
    const targetRunId = nextRunId ? String(nextRunId) : null;
    const previousRunIdValue = previousRunId ? String(previousRunId) : null;

    try {
      const activeRun = await this.getActiveMarketUniverseRun();
      const activeRunId = activeRun && activeRun.runId ? String(activeRun.runId) : null;

      if (!activeRunId) {
        return { warm: false, runId: null, state: 'COLD', active: false, reason: 'no-active-run' };
      }

      if (targetRunId && activeRunId !== targetRunId) {
        return {
          warm: false,
          runId: activeRunId,
          state: this.activeUniverseCache && this.activeUniverseCache.runId === activeRunId && this.activeUniverseCache.state === 'WARM' ? 'WARM' : 'COLD',
          active: true,
          reason: previousRunIdValue && activeRunId === previousRunIdValue ? 'activation-rollback' : 'activation-mismatch'
        };
      }

      if (this.activeUniverseCache && this.activeUniverseCache.runId === activeRunId && this.activeUniverseCache.state === 'WARM') {
        return {
          warm: true,
          runId: activeRunId,
          state: 'WARM',
          active: true,
          loadMs: Number(this.activeUniverseCache.loadMs || 0)
        };
      }

      this.invalidateActiveUniverseCache();

      const cache = await this.getActiveUniverseCache();
      const warm = Boolean(cache && cache.runId === activeRunId && cache.state === 'WARM');

      if (cache && cache.runId === activeRunId) {
        this.activeUniverseCache = {
          ...this.activeUniverseCache,
          ...(cache || {}),
          runId: activeRunId,
          state: warm ? 'WARM' : (cache && cache.state ? cache.state : 'COLD')
        };
      }

      return {
        warm,
        runId: activeRunId,
        state: warm ? 'WARM' : (cache && cache.state ? cache.state : 'COLD'),
        active: true,
        loadMs: Number(cache?.loadMs || 0)
      };
    } catch (error) {
      const activeRun = await this.getActiveMarketUniverseRun().catch(() => null);
      const activeRunId = activeRun && activeRun.runId ? String(activeRun.runId) : (targetRunId || null);

      if (this.activeUniverseCache && this.activeUniverseCache.runId === activeRunId && this.activeUniverseCache.state === 'WARM') {
        return {
          warm: true,
          runId: activeRunId,
          state: 'WARM',
          active: true,
          loadMs: Number(this.activeUniverseCache.loadMs || 0)
        };
      }

      return {
        warm: false,
        runId: activeRunId,
        state: 'COLD',
        active: Boolean(activeRunId),
        error: error?.message || 'Market Universe cache warm-up failed after activation',
        code: error?.code || 'MARKET_UNIVERSE_CACHE_WARMUP_FAILED'
      };
    }
  }

  static async getActiveUniverseCache() {
    const activeRun = await this.getActiveMarketUniverseRun();
    const currentCache = this.activeUniverseCache;

    if (currentCache && currentCache.runId === activeRun.runId && currentCache.state === 'WARM' && currentCache.returns && currentCache.assetOrder.length === Number(activeRun.assetCount || 0)) {
      this.activeUniverseStats.cacheHits = Number(this.activeUniverseStats.cacheHits || 0) + 1;
      return currentCache;
    }

    if (this.activeUniverseLoadPromise) {
      return this.activeUniverseLoadPromise;
    }

    this.activeUniverseStats.cacheMisses = Number(this.activeUniverseStats.cacheMisses || 0) + 1;

    const loadPromise = (async () => {
      const startedAt = Date.now();
      const binaryCache = await loadBinaryCache(activeRun, startedAt);
      if (binaryCache) {
        this.activeUniverseCache = binaryCache;
        this.activeUniverseStats.dbLoads = Number(this.activeUniverseStats.dbLoads || 0) + 1;
        this.activeUniverseStats.lastLoadMs = Number(binaryCache.loadMs || 0);
        return binaryCache;
      }

      const pathCount = Number(activeRun.pathCount || 0);
      const monthCount = Number(activeRun.monthCount || 0);
      const assetCount = Number(activeRun.assetCount || 0);
      const assetOrder = Array.isArray(activeRun.assetOrder) ? activeRun.assetOrder.map((isin) => String(isin || '').trim().toUpperCase()) : [];
      const expectedRows = pathCount * monthCount;
      const returnStorage = new Float64Array(pathCount * monthCount * assetCount);
      const scenarioStorage = new Array(pathCount * monthCount);
      const intensityStorage = new Float64Array(pathCount * monthCount);

      // Load one path-range at a time instead of materialising all 360k Sequelize
      // rows at once. This keeps peak memory bounded on smaller production instances
      // while writing each batch directly into the final compact cache.
      const pathsPerBatch = Math.max(1, Number(process.env.MARKET_UNIVERSE_CACHE_PATH_BATCH_SIZE || 50));
      let loadedRows = 0;

      for (let pathStart = 0; pathStart < pathCount; pathStart += pathsPerBatch) {
        const pathEnd = Math.min(pathCount, pathStart + pathsPerBatch);
        const rows = await MarketUniverseMonth.findAll({
          where: {
            runId: activeRun.runId,
            pathId: { [Op.gte]: pathStart, [Op.lt]: pathEnd }
          },
          attributes: ['pathId', 'monthIndex', 'scenario', 'intensity', 'returnsVector'],
          raw: true,
          order: [['pathId', 'ASC'], ['monthIndex', 'ASC']]
        });

        loadedRows += rows.length;

        for (const row of rows) {
          const pathId = Number(row.pathId || 0);
          const monthIndex = Number(row.monthIndex || 0);
          const vector = Array.isArray(row.returnsVector) ? row.returnsVector : [];
          if (vector.length !== assetCount) {
            const error = new Error(`Persisted Market Universe vector for path ${pathId}, month ${monthIndex} is shorter than asset_order metadata`);
            error.code = 'INVALID_ACTIVE_MARKET_UNIVERSE_VECTOR';
            error.statusCode = 409;
            throw error;
          }

          const linearIndex = (pathId * monthCount + monthIndex) * assetCount;
          for (let assetIndex = 0; assetIndex < assetCount; assetIndex += 1) {
            returnStorage[linearIndex + assetIndex] = Number(vector[assetIndex] || 0);
          }
          scenarioStorage[pathId * monthCount + monthIndex] = row.scenario || '';
          intensityStorage[pathId * monthCount + monthIndex] = Number(row.intensity || 0);
        }
      }

      if (loadedRows === 0) {
        const error = new Error('Active Market Universe contains no persisted month rows');
        error.code = 'EMPTY_ACTIVE_MARKET_UNIVERSE';
        error.statusCode = 409;
        throw error;
      }

      if (expectedRows > 0 && loadedRows !== expectedRows) {
        const error = new Error(`Persisted Market Universe geometry mismatch: expected ${expectedRows} rows but found ${loadedRows}`);
        error.code = 'INVALID_ACTIVE_MARKET_UNIVERSE_GEOMETRY';
        error.statusCode = 409;
        throw error;
      }

      const cache = {
        runId: activeRun.runId,
        pathCount,
        monthCount,
        assetCount,
        assetOrder,
        returns: returnStorage,
        scenarios: scenarioStorage,
        intensities: intensityStorage,
        loadedAt: new Date().toISOString(),
        loadMs: Date.now() - startedAt,
        state: 'WARM'
      };

      if (cache.runId !== activeRun.runId) {
        const error = new Error('Active Market Universe cache runId validation failed');
        error.code = 'INVALID_ACTIVE_MARKET_UNIVERSE_CACHE';
        error.statusCode = 409;
        throw error;
      }

      await persistBinaryCache(cache, this.withRetry.bind(this));

      this.activeUniverseCache = cache;
      this.activeUniverseStats.dbLoads = Number(this.activeUniverseStats.dbLoads || 0) + 1;
      this.activeUniverseStats.lastLoadMs = Number(cache.loadMs || 0);
      return cache;
    })();

    this.activeUniverseLoadPromise = loadPromise;

    try {
      return await loadPromise;
    } finally {
      if (this.activeUniverseLoadPromise === loadPromise) {
        this.activeUniverseLoadPromise = null;
      }
    }
  }

  static async withRetry(operationName, operation, options = {}) {
    const maxAttempts = Number(options.maxAttempts || 4);
    const baseDelayMs = Number(options.baseDelayMs || 150);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        const shouldRetry = isTransientDbError(error) && attempt < maxAttempts;
        if (!shouldRetry) {
          const normalizedError = new Error(error?.message || `${operationName} failed`);
          normalizedError.code = error?.code || 'MARKET_UNIVERSE_DB_ERROR';
          normalizedError.statusCode = error?.statusCode || 500;
          normalizedError.details = error?.details || {};
          throw normalizedError;
        }

        await sleep(baseDelayMs * attempt);
      }
    }

    throw new Error(`${operationName} failed after retries`);
  }

  static async reconcileActiveUniverseState(oldRunId, newRunId) {
    const activeRuns = await MarketUniverseRun.findAll({
      where: { active: true },
      attributes: ['runId', 'status', 'active']
    });
    const activeIds = activeRuns.map((run) => String(run.runId));
    const oldActive = oldRunId ? activeIds.includes(String(oldRunId)) : false;
    const newActive = newRunId ? activeIds.includes(String(newRunId)) : false;

    if (activeRuns.length > 1) {
      return { outcome: 'inconsistent', activeRuns };
    }

    if (activeRuns.length === 1 && newActive) {
      return { outcome: 'committed', activeRuns };
    }

    if (activeRuns.length === 1 && oldActive) {
      return { outcome: 'rolled-back', activeRuns };
    }

    if (activeRuns.length === 0) {
      return { outcome: 'zero-active', activeRuns };
    }

    return { outcome: 'inconsistent', activeRuns };
  }

  static async activateReplacementRun(previousRun, nextRun) {
    const previousRunId = previousRun && previousRun.runId ? previousRun.runId : null;
    const nextRunId = nextRun && nextRun.runId ? nextRun.runId : null;

    if (!previousRunId || !nextRunId) {
      return { switchCommitted: false, outcome: 'no-switch-needed' };
    }

    try {
      await sequelize.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED }, async (transaction) => {
        await MarketUniverseRun.update(
          { active: false },
          { where: { runId: previousRunId }, transaction }
        );
        await MarketUniverseRun.update(
          { status: 'ACTIVE', active: true },
          { where: { runId: nextRunId }, transaction }
        );
      });

      return { switchCommitted: true, outcome: 'committed' };
    } catch (error) {
      if (!isTransientDbError(error)) {
        throw error;
      }

      const state = await this.reconcileActiveUniverseState(previousRunId, nextRunId);

      if (state.outcome === 'committed') {
        return { switchCommitted: true, outcome: 'committed' };
      }

      if (state.outcome === 'rolled-back') {
        const freshPreviousRun = await MarketUniverseRun.findByPk(previousRunId);
        const freshNextRun = await MarketUniverseRun.findByPk(nextRunId);
        return this.activateReplacementRun(freshPreviousRun, freshNextRun);
      }

      if (state.outcome === 'zero-active') {
        const activeSwitchFailure = new Error('Market Universe active switch left zero active runs after transient DB failure');
        activeSwitchFailure.code = 'MARKET_UNIVERSE_SWITCH_AMBIGUOUS';
        activeSwitchFailure.statusCode = 500;
        throw activeSwitchFailure;
      }

      const activeSwitchFailure = new Error('Market Universe active switch left an inconsistent active-run state');
      activeSwitchFailure.code = 'MARKET_UNIVERSE_SWITCH_INCONSISTENT';
      activeSwitchFailure.statusCode = 500;
      throw activeSwitchFailure;
    }
  }

  static async destroyOldRunSafe(previousRun) {
    if (!previousRun || !previousRun.runId) {
      return { destroyed: false, outcome: 'no-run' };
    }

    try {
      await MarketUniverseMonth.destroy({ where: { runId: previousRun.runId } });
      await MarketUniverseBinaryChunk.destroy({ where: { runId: previousRun.runId } });
      await this.withRetry('destroy-run', () => previousRun.destroy());
      return { destroyed: true, outcome: 'deleted' };
    } catch (error) {
      if (!isTransientDbError(error)) {
        throw error;
      }

      const freshPreviousRun = await MarketUniverseRun.findByPk(previousRun.runId);
      if (!freshPreviousRun) {
        return { destroyed: true, outcome: 'already-deleted' };
      }

      return this.destroyOldRunSafe(freshPreviousRun);
    }
  }

  static isAssetComplete(asset) {
    if (!asset || !asset.id || !asset.isin || !asset.name) {
      return false;
    }

    const requiredGeneralStats = [
      asset.expectedReturn,
      asset.volatility,
      asset.maxDrawdown
    ];

    if (requiredGeneralStats.some((value) => value === null || value === undefined || Number.isNaN(Number(value)))) {
      return false;
    }

    const scenarioKeys = ['general', 'expansion', 'soft_landing', 'recession', 'stagflation'];
    return scenarioKeys.every((key) => asset[key] !== null && asset[key] !== undefined && typeof asset[key] === 'object');
  }

  static async readCanonicalMarketUniverseSources() {
    const [etfs, macroRows] = await Promise.all([
      ETF.findAll({
        include: [{
          model: EtfMacroStatistics,
          as: 'macroStats',
          required: false,
          attributes: ['macroScenario', 'expectedReturn', 'volatility', 'maxDrawdown', 'returnRangeMin', 'returnRangeMax']
        }]
      }),
      EtfMacroStatistics.findAll({
        attributes: ['isin', 'macroScenario', 'expectedReturn', 'volatility', 'maxDrawdown', 'returnRangeMin', 'returnRangeMax'],
        raw: true
      })
    ]);

    return { etfs, macroRows };
  }

  static buildCanonicalMarketUniverseAssets(etfs, macroRows) {
    const macroMapByIsin = new Map();
    for (const row of macroRows) {
      const key = String(row.isin || '').trim().toUpperCase();
      if (!key) {
        continue;
      }
      if (!macroMapByIsin.has(key)) {
        macroMapByIsin.set(key, []);
      }
      macroMapByIsin.get(key).push(row);
    }

    const assetsByIsin = new Map();
    for (const etf of etfs) {
      const raw = etf.toJSON ? etf.toJSON() : etf;
      const macroStats = Array.isArray(raw.macroStats) && raw.macroStats.length > 0
        ? raw.macroStats
        : (macroMapByIsin.get(String(raw.isin || '').trim().toUpperCase()) || []);

      const normalized = normalizeLegacyAsset({ ...raw, macroStats });
      if (!normalized.isin) {
        continue;
      }
      if (!assetsByIsin.has(normalized.isin)) {
        assetsByIsin.set(normalized.isin, normalized);
      }
    }

    return [...assetsByIsin.values()];
  }

  static async getAllAssets(options = {}) {
    const { legacyFallback = null } = options;

    try {
      const { etfs, macroRows } = await this.readCanonicalMarketUniverseSources();
      return this.buildCanonicalMarketUniverseAssets(etfs, macroRows);
    } catch (error) {
      if (Array.isArray(legacyFallback) && legacyFallback.length > 0) {
        return legacyFallback.map((etf) => normalizeLegacyAsset(etf, { legacyFallback: true }));
      }
      throw error;
    }
  }

  static async buildMarketUniverse(options = {}) {
    const { legacyFallback = null, skipValidation = false } = options;

    try {
      const { etfs, macroRows } = await this.readCanonicalMarketUniverseSources();
      const duplicateIds = [];
      const seenIds = new Set();
      const seenIsins = new Set();
      const duplicateIsins = [];

      for (const etf of etfs || []) {
        const raw = etf.toJSON ? etf.toJSON() : etf;
        const normalizedId = String(raw?.id ?? '').trim();
        const normalizedIsin = String(raw?.isin ?? '').trim().toUpperCase();

        if (normalizedId) {
          if (seenIds.has(normalizedId)) {
            duplicateIds.push(normalizedId);
          } else {
            seenIds.add(normalizedId);
          }
        }

        if (normalizedIsin) {
          if (seenIsins.has(normalizedIsin)) {
            duplicateIsins.push(normalizedIsin);
          } else {
            seenIsins.add(normalizedIsin);
          }
        }
      }

      if (duplicateIsins.length > 0) {
        const error = new Error(`Duplicate ISIN values detected: ${duplicateIsins.join(', ')}`);
        error.code = 'DUPLICATE_ISIN';
        error.statusCode = 409;
        throw error;
      }

      if (duplicateIds.length > 0) {
        const error = new Error(`Duplicate asset ids detected: ${duplicateIds.join(', ')}`);
        error.code = 'DUPLICATE_ID';
        error.statusCode = 409;
        throw error;
      }

      const assets = this.buildCanonicalMarketUniverseAssets(etfs, macroRows);

      if (skipValidation) {
        return {
          success: true,
          assetCount: assets.length,
          completeAssetCount: assets.filter((asset) => this.isAssetComplete(asset)).length,
          incompleteAssetCount: assets.filter((asset) => !this.isAssetComplete(asset)).length,
          legacyAssetCount: assets.filter((asset) => asset.source === 'legacy-fallback' || asset.legacyFallback === true).length,
          generatedAt: new Date().toISOString(),
          assets
        };
      }

      const completeAssetCount = assets.filter((asset) => this.isAssetComplete(asset)).length;
      const incompleteAssetCount = assets.length - completeAssetCount;
      const legacyAssetCount = assets.filter((asset) => asset.source === 'legacy-fallback' || asset.legacyFallback === true).length;

      return {
        success: true,
        assetCount: assets.length,
        completeAssetCount,
        incompleteAssetCount,
        legacyAssetCount,
        generatedAt: new Date().toISOString(),
        assets
      };
    } catch (error) {
      if (Array.isArray(legacyFallback) && legacyFallback.length > 0) {
        return {
          success: true,
          assetCount: legacyFallback.length,
          completeAssetCount: legacyFallback.length,
          incompleteAssetCount: 0,
          legacyAssetCount: legacyFallback.length,
          generatedAt: new Date().toISOString(),
          assets: legacyFallback.map((etf) => normalizeLegacyAsset(etf, { legacyFallback: true }))
        };
      }

      if (!error || !error.code) {
        const normalizedError = new Error(error?.message || 'Market Universe regeneration failed');
        normalizedError.code = 'MARKET_UNIVERSE_READ_FAILED';
        normalizedError.statusCode = 500;
        throw normalizedError;
      }

      throw error;
    }
  }

  static async regenerateMarketUniverse(options = {}) {
    const {
      seed = 42,
      pathCount = 1000,
      monthCount = 360,
      assetOrder = null,
      dryRun = false
    } = options;

    this.invalidateActiveUniverseCache();

    try {
      const rawEtfs = await ETF.findAll({ raw: true });
      const duplicateIsins = rawEtfs
        .map((etf) => String(etf.isin || '').trim().toUpperCase())
        .filter((isin) => isin && rawEtfs.filter((row) => String(row.isin || '').trim().toUpperCase() === isin).length > 1);

      if (duplicateIsins.length > 0) {
        const error = new Error(`Duplicate ISIN values detected: ${duplicateIsins.join(', ')}`);
        error.code = 'DUPLICATE_ISIN';
        error.statusCode = 409;
        throw error;
      }

      const assets = await this.getAllAssets();
      if (!Array.isArray(assets) || assets.length === 0) {
        const error = new Error('No ETF assets available to build the Market Universe');
        error.code = 'MARKET_UNIVERSE_EMPTY';
        error.statusCode = 422;
        throw error;
      }

      const orderedIsins = (assetOrder || assets.map((asset) => asset.isin).filter(Boolean)).filter((isin, index, list) => isin && list.indexOf(isin) === index);
      if (orderedIsins.length === 0) {
        const error = new Error('Market Universe requires at least one ETF ISIN');
        error.code = 'MARKET_UNIVERSE_EMPTY';
        error.statusCode = 422;
        throw error;
      }

      const etfs = assets.filter((asset) => orderedIsins.includes(asset.isin));
      const macroRows = await EtfMacroStatistics.findAll({ where: { isin: { [Op.in]: orderedIsins } }, raw: true });
      const correlations = normalizeLiveCorrelationMatrix(await EtfCorrelation.findAll({ where: { [Op.or]: [{ isin1: { [Op.in]: orderedIsins } }, { isin2: { [Op.in]: orderedIsins } }] }, raw: true }));
      const structuralProbabilities = StructuralProbability ? await StructuralProbability.findAll({ raw: true }) : [];
      const transitions = TransitionMatrix ? await TransitionMatrix.findAll({ raw: true }) : [];
      const inertiaConfigurations = ScenarioInertiaConfiguration ? await ScenarioInertiaConfiguration.findAll({ raw: true }) : [];
      const intensityConfigurations = ScenarioIntensityConfiguration ? await ScenarioIntensityConfiguration.findAll({ raw: true }) : [];
      const globalProperties = MonteCarloGlobalProperty ? await MonteCarloGlobalProperty.findAll({ raw: true }) : [];

      const snapshot = buildMonteCarloSnapshot({
        isins: orderedIsins,
        etfs: etfs.map((asset) => ({ isin: asset.isin, name: asset.name, nickname: asset.nickname || null })),
        macroStatistics: macroRows,
        structuralProbabilities,
        transitions,
        inertiaConfigurations,
        intensityConfigurations,
        globalProperties,
        correlations
      });

      const runtime = await loadSharedMonteCarloCore();
      const precompute = runtime.prepareMonteCarloPrecomputation(snapshot);
      const previousRun = await MarketUniverseRun.findOne({
        where: { active: true },
        order: [['generatedAt', 'DESC']]
      });

      const run = await MarketUniverseRun.create({
        seed,
        pathCount,
        monthCount,
        assetCount: orderedIsins.length,
        assetOrder: orderedIsins,
        status: 'GENERATING',
        active: false
      });
      const applyRunPatch = async (target, patch) => {
        if (target && typeof target.update === 'function') {
          return this.withRetry('update-run', () => target.update(patch));
        }
        Object.assign(target || {}, patch);
        return target || patch;
      };
      const destroyRun = async (target) => {
        if (target && typeof target.destroy === 'function') {
          return this.withRetry('destroy-run', () => target.destroy());
        }
        return 0;
      };

      let rowCount = 0;
      const chunkSize = 500;
      const rows = [];

      for (let pathId = 0; pathId < Number(pathCount); pathId += 1) {
        const random = new runtime.SeededRandom(runtime.derivePathSeed(seed, pathId));
        const macroTimeline = runtime.generateMonthlyMacroTimeline(snapshot, Number(monthCount), () => random.next());

        const monthEntries = macroTimeline.months || [];
        for (let monthIndex = 0; monthIndex < monthEntries.length; monthIndex += 1) {
          const monthState = monthEntries[monthIndex];
          const vector = runtime.generateMonthlyReturnVector(snapshot, precompute, monthState.scenario, monthState.intensity, () => random.next());
          const returnsVector = vector.etfReturns.map((entry) => Number(entry.monthlyReturn));

          if (returnsVector.length !== orderedIsins.length) {
            throw new Error(`Monte Carlo vector length mismatch for path ${pathId}, month ${monthIndex}`);
          }

          rows.push({
            runId: run.runId,
            pathId,
            monthIndex,
            scenario: monthState.scenario,
            intensity: Number(monthState.intensity),
            returnsVector
          });

          if (rows.length >= chunkSize) {
            await this.withRetry('bulk-create-market-universe-month', () => MarketUniverseMonth.bulkCreate(rows, {
              validate: true,
              updateOnDuplicate: ['scenario', 'intensity', 'returnsVector']
            }));
            rowCount += rows.length;
            rows.length = 0;
          }
        }
      }

      if (rows.length > 0) {
        await this.withRetry('bulk-create-market-universe-month', () => MarketUniverseMonth.bulkCreate(rows, {
          validate: true,
          updateOnDuplicate: ['scenario', 'intensity', 'returnsVector']
        }));
        rowCount += rows.length;
      }

      await applyRunPatch(run, { status: 'READY', active: false });

      if (previousRun && previousRun.runId !== run.runId) {
        const switchState = await this.activateReplacementRun(previousRun, run);
        if (!switchState.switchCommitted) {
          throw new Error('Market Universe active switch did not commit');
        }

        Object.assign(run, { status: 'ACTIVE', active: true });
        await this.destroyOldRunSafe(previousRun);
      } else {
        await applyRunPatch(run, { status: 'ACTIVE', active: true });
      }

      const cachePromotion = await this.promoteActiveUniverseCacheAfterActivation(
        previousRun && previousRun.runId ? previousRun.runId : null,
        run && run.runId ? run.runId : null
      );

      const runPayload = run && typeof run.toJSON === 'function' ? run.toJSON() : (run || {});

      if (dryRun) {
        return {
          success: true,
          dryRun: true,
          run: { ...runPayload, status: 'ACTIVE', active: true },
          rowCount,
          cache: {
            warm: Boolean(cachePromotion?.warm),
            runId: cachePromotion?.runId || run?.runId || null,
            state: cachePromotion?.state || 'COLD',
            loadMs: Number(cachePromotion?.loadMs || 0),
            error: cachePromotion?.error || null,
            code: cachePromotion?.code || null
          }
        };
      }

      return {
        success: true,
        run: { ...runPayload, status: 'ACTIVE', active: true },
        rowCount,
        cache: {
          warm: Boolean(cachePromotion?.warm),
          runId: cachePromotion?.runId || run?.runId || null,
          state: cachePromotion?.state || 'COLD',
          loadMs: Number(cachePromotion?.loadMs || 0),
          error: cachePromotion?.error || null,
          code: cachePromotion?.code || null
        }
      };
    } catch (error) {
      const normalizedError = new Error(error?.message || 'Market Universe regeneration failed');
      normalizedError.code = error?.code || 'MARKET_UNIVERSE_READ_FAILED';
      normalizedError.statusCode = error?.statusCode || 500;
      normalizedError.details = error?.details || {};
      throw normalizedError;
    }
  }

  static normalizePortfolioHoldings(holdings) {
    if (!Array.isArray(holdings) || holdings.length === 0) {
      const error = new Error('Portfolio holdings are required to resolve the active Market Universe projection');
      error.code = 'INVALID_PORTFOLIO_HOLDINGS';
      error.statusCode = 400;
      throw error;
    }

    const normalized = holdings
      .map((holding) => {
        const isin = String(holding?.isin || holding?.etfId || holding?.id || '').trim().toUpperCase();
        const weight = Number(holding?.weight ?? holding?.targetWeight ?? 0);

        if (!isin || !Number.isFinite(weight) || weight <= 0) {
          return null;
        }

        return { isin, weight };
      })
      .filter(Boolean);

    if (normalized.length === 0) {
      const error = new Error('Portfolio holdings do not contain any valid ETF ISIN values');
      error.code = 'INVALID_PORTFOLIO_HOLDINGS';
      error.statusCode = 400;
      throw error;
    }

    const totalWeight = normalized.reduce((sum, holding) => sum + holding.weight, 0);
    if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
      const error = new Error('Portfolio holdings must resolve to a positive total weight');
      error.code = 'INVALID_PORTFOLIO_HOLDINGS';
      error.statusCode = 400;
      throw error;
    }

    return normalized.map((holding) => ({
      isin: holding.isin,
      weight: holding.weight / totalWeight
    }));
  }

  static async getActiveMarketUniverseRun() {
    const activeRuns = await MarketUniverseRun.findAll({
      where: { active: true },
      order: [['generatedAt', 'DESC']],
      raw: true
    });

    if (activeRuns.length === 0) {
      const error = new Error('No active Market Universe run is available');
      error.code = 'NO_ACTIVE_MARKET_UNIVERSE';
      error.statusCode = 404;
      throw error;
    }

    if (activeRuns.length > 1) {
      const error = new Error('Multiple active Market Universe runs found; expected exactly one');
      error.code = 'MULTIPLE_ACTIVE_MARKET_UNIVERSE';
      error.statusCode = 409;
      throw error;
    }

    const run = activeRuns[0];
    if (run.status !== 'ACTIVE') {
      const error = new Error(`Active Market Universe has invalid status: ${run.status}`);
      error.code = 'INVALID_ACTIVE_MARKET_UNIVERSE_STATUS';
      error.statusCode = 409;
      throw error;
    }

    const assetOrder = Array.isArray(run.assetOrder) ? run.assetOrder.map((isin) => String(isin || '').trim().toUpperCase()) : [];
    if (assetOrder.length === 0 || Number(run.assetCount || 0) !== assetOrder.length) {
      const error = new Error('Active Market Universe has invalid asset_order metadata');
      error.code = 'INVALID_ACTIVE_MARKET_UNIVERSE_ASSET_ORDER';
      error.statusCode = 409;
      throw error;
    }

    const expectedRows = Number(run.pathCount || 0) * Number(run.monthCount || 0);
    if (expectedRows > 0) {
      const actualRows = await MarketUniverseMonth.count({ where: { runId: run.runId } });
      if (actualRows !== expectedRows) {
        const error = new Error(`Persisted Market Universe geometry mismatch: expected ${expectedRows} rows but found ${actualRows}`);
        error.code = 'INVALID_ACTIVE_MARKET_UNIVERSE_GEOMETRY';
        error.statusCode = 409;
        throw error;
      }
    }

    return run;
  }

  static async buildPortfolioProjectionFromActiveMarketUniverse(options = {}) {
    const { holdings = [], limitPaths = null, maxMonths = null } = options;
    const normalizedHoldings = this.normalizePortfolioHoldings(holdings);
    const activeRun = await this.getActiveMarketUniverseRun();
    const assetOrder = Array.isArray(activeRun.assetOrder) ? activeRun.assetOrder.map((isin) => String(isin || '').trim().toUpperCase()) : [];
    const assetIndexByIsin = new Map(assetOrder.map((isin, index) => [isin, index]));

    const missingAssets = normalizedHoldings.filter((holding) => !assetIndexByIsin.has(holding.isin));
    if (missingAssets.length > 0) {
      const error = new Error(`Portfolio holdings include ETF ISINs not present in the active Market Universe: ${missingAssets.map((asset) => asset.isin).join(', ')}`);
      error.code = 'MISSING_ETF_IN_ACTIVE_MARKET_UNIVERSE';
      error.statusCode = 409;
      throw error;
    }

    const cache = await this.getActiveUniverseCache();
    const pathLimit = Number.isInteger(limitPaths) && limitPaths > 0 ? Number(limitPaths) : Number(activeRun.pathCount || 0);
    const monthLimit = Number.isInteger(maxMonths) && maxMonths > 0 ? Number(maxMonths) : Number(activeRun.monthCount || 0);
    const pathCount = Math.min(Number(cache.pathCount || activeRun.pathCount || 0), pathLimit);
    const monthCount = Math.min(Number(cache.monthCount || activeRun.monthCount || 0), monthLimit);
    const groupedByPath = new Map();

    for (let pathId = 0; pathId < pathCount; pathId += 1) {
      const monthlyEntries = [];
      const baseOffset = (pathId * Number(cache.monthCount || activeRun.monthCount || 0)) * Number(cache.assetCount || activeRun.assetCount || 0);

      for (let monthIndex = 0; monthIndex < monthCount; monthIndex += 1) {
        const offset = baseOffset + (monthIndex * Number(cache.assetCount || activeRun.assetCount || 0));
        const scenario = cache.scenarios?.[pathId * Number(cache.monthCount || activeRun.monthCount || 0) + monthIndex] || null;
        const intensity = Number(cache.intensities?.[pathId * Number(cache.monthCount || activeRun.monthCount || 0) + monthIndex] ?? 0);
        let weightedReturn = 0;

        for (const holding of normalizedHoldings) {
          const assetIndex = assetIndexByIsin.get(holding.isin);
          if (assetIndex === undefined) {
            throw new Error(`Persisted Market Universe vector for path ${pathId}, month ${monthIndex} is shorter than asset_order metadata`);
          }
          const returnValue = Number(cache.returns?.[offset + assetIndex] ?? 0);
          weightedReturn += holding.weight * returnValue;
        }

        monthlyEntries.push({
          pathId,
          monthIndex,
          scenario,
          intensity,
          weightedReturn
        });
      }

      groupedByPath.set(pathId, monthlyEntries);
    }

    const paths = [...groupedByPath.entries()]
      .sort(([left], [right]) => Number(left) - Number(right))
      .map(([pathId, entries]) => ({
        pathId: Number(pathId),
        monthlyReturns: entries
          .map((entry) => Number(entry.weightedReturn)),
        months: entries
          .map((entry) => ({
            monthIndex: Number(entry.monthIndex),
            scenario: entry.scenario,
            intensity: Number(entry.intensity),
            weightedReturn: Number(entry.weightedReturn)
          }))
      }));

    return {
      success: true,
      run: {
        runId: activeRun.runId,
        generatedAt: activeRun.generatedAt,
        status: activeRun.status,
        active: activeRun.active,
        pathCount: Number(activeRun.pathCount),
        monthCount: Number(activeRun.monthCount),
        assetCount: Number(activeRun.assetCount),
        assetOrder
      },
      weights: normalizedHoldings,
      pathCount: paths.length,
      monthCount: paths[0]?.monthlyReturns.length || 0,
      paths,
      cache: {
        state: cache.state,
        runId: cache.runId,
        loadMs: Number(cache.loadMs || 0),
        hit: cache.runId === activeRun.runId && cache.state === 'WARM'
      }
    };
  }

  static async buildBinaryPortfolioProjection(options = {}) {
    const {
      holdings = [],
      limitPaths = null,
      maxMonths = null,
      requestedRunId = null,
      previousRunId = null,
      knownRunId = null,
      payloadType = 'FULL'
    } = options;

    const resolvedRequestedRunId = knownRunId ?? requestedRunId ?? null;

    const projection = await this.buildPortfolioProjectionFromActiveMarketUniverse({
      holdings,
      limitPaths,
      maxMonths
    });

    const activeRunId = String(projection?.run?.runId || '');
    const nextPayloadType = String(payloadType || 'FULL').toUpperCase() === 'RETURNS_ONLY' || (resolvedRequestedRunId && previousRunId && String(previousRunId) === String(resolvedRequestedRunId) && String(resolvedRequestedRunId) === activeRunId)
      ? 'RETURNS_ONLY'
      : 'FULL';

    const flatReturns = [];
    const flatIntensities = [];
    const flatScenarios = [];

    for (const path of Array.isArray(projection?.paths) ? projection.paths : []) {
      for (const month of Array.isArray(path?.months) ? path.months : []) {
        flatReturns.push(Number(month?.weightedReturn ?? 0));
        flatIntensities.push(Number(month?.intensity ?? 0));
        flatScenarios.push(month?.scenario ?? 'expansion');
      }
    }

    const binary = encodeMarketUniverseBinary({
      runId: activeRunId,
      pathCount: Number(projection?.pathCount || 0),
      monthCount: Number(projection?.monthCount || 0),
      payloadType: nextPayloadType,
      returns: flatReturns,
      intensities: nextPayloadType === 'FULL' ? flatIntensities : [],
      scenarios: nextPayloadType === 'FULL' ? flatScenarios : []
    });

    return {
      success: true,
      version: 1,
      payloadType: nextPayloadType,
      runId: activeRunId,
      pathCount: Number(projection?.pathCount || 0),
      monthCount: Number(projection?.monthCount || 0),
      returns: flatReturns,
      intensities: nextPayloadType === 'FULL' ? flatIntensities : null,
      scenarios: nextPayloadType === 'FULL' ? flatScenarios : null,
      geometry: {
        pathCount: Number(projection?.pathCount || 0),
        monthCount: Number(projection?.monthCount || 0),
        totalValues: flatReturns.length,
        requestedRunId: resolvedRequestedRunId ? String(resolvedRequestedRunId) : null,
        previousRunId: previousRunId ? String(previousRunId) : null
      },
      buffer: binary,
      rawBuffer: binary
    };
  }

  static async getAssetById(id) {
    const assets = await this.getAllAssets();
    return assets.find((asset) => String(asset.id) === String(id)) || null;
  }

  static async getAssetByIsin(isin) {
    const normalizedIsin = String(isin || '').trim().toUpperCase();
    if (!normalizedIsin) {
      return null;
    }

    const assets = await this.getAllAssets();
    return assets.find((asset) => String(asset.isin || '').trim().toUpperCase() === normalizedIsin) || null;
  }

  static async searchAssets(query, options = {}) {
    const normalizedQuery = String(query || '').trim().toLowerCase();
    if (!normalizedQuery) {
      return this.filterAssets(() => true, options);
    }

    const assets = await this.getAllAssets(options);
    return assets.filter((asset) => {
      const haystack = [
        asset.name,
        asset.nickname,
        asset.isin,
        asset.ticker,
        asset.assetClass,
        asset.category,
        asset.description
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }

  static async filterAssets(predicate, options = {}) {
    const assets = await this.getAllAssets(options);
    return assets.filter((asset) => predicate(asset));
  }

  static rehydrateLegacyPortfolioHoldings(holdings, assets) {
    if (!Array.isArray(holdings)) {
      return [];
    }

    const assetMap = new Map();
    for (const asset of assets) {
      assetMap.set(String(asset.isin || '').trim().toUpperCase(), asset);
    }

    return holdings.map((holding) => {
      const rawIsin = String(holding.isin || holding.etfId || '').trim().toUpperCase();
      const matchedAsset = assetMap.get(rawIsin) || null;
      return {
        ...matchedAsset,
        ...holding,
        weight: typeof holding.weight === 'number' ? holding.weight : Number(holding.weight || 0),
        isin: holding.isin || matchedAsset?.isin || '',
        id: holding.id || matchedAsset?.id || holding.isin || holding.etfId || undefined,
        source: matchedAsset?.source || 'legacy-portfolio-holding'
      };
    });
  }
}

module.exports = {
  MarketUniverseService: MarketUniverseServiceClass,
  normalizeLegacyAsset,
  SCENARIO_KEYS
};
