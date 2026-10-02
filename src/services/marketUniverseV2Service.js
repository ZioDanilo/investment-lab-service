const { Op } = require('sequelize');
const ETF = require('../models/ETF');
const EtfMacroStatistics = require('../models/EtfMacroStatistics');
const EtfCorrelation = require('../models/EtfCorrelation');
const StructuralProbability = require('../models/StructuralProbability');
const TransitionMatrix = require('../models/TransitionMatrix');
const ScenarioInertiaConfiguration = require('../models/ScenarioInertiaConfiguration');
const ScenarioIntensityConfiguration = require('../models/ScenarioIntensityConfiguration');
const MonteCarloGlobalProperty = require('../models/MonteCarloGlobalProperty');
const MarketUniverseRunV2 = require('../models/MarketUniverseRunV2');
const MarketUniverseEtfV2 = require('../models/MarketUniverseEtfV2');
const { FactorMarketUniverseSnapshotService } = require('./factorMarketUniverseSnapshotService');
const { buildMonteCarloSnapshot } = require('../utils/monteCarloSnapshot');
const { encodeMarketUniverseBinary, PAYLOAD_TYPE_FULL } = require('../utils/marketUniverseBinaryTransport');
const marketUniverseV2Cache = require('./marketUniverseV2Cache');

const SCENARIOS = ['expansion','soft_landing','recession','stagflation'];
const scenarioCode = (value) => Math.max(0, SCENARIOS.indexOf(String(value || 'expansion')));
const decodeScenario = (code) => SCENARIOS[Number(code)] || 'expansion';
const normalizeIsin = (value) => String(value || '').trim().toUpperCase();

const float32ToBuffer = (values) => Buffer.from(values.buffer, values.byteOffset, values.byteLength);
const bufferToFloat32 = (value) => {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  if (buffer.byteLength % 4 !== 0) throw Object.assign(new Error('Invalid V2 Float32 binary payload'), { code: 'INVALID_MARKET_UNIVERSE_V2_BINARY', statusCode: 409 });
  const copy = Buffer.from(buffer);
  return new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4);
};

class MarketUniverseV2Service {
  static async getActiveRun() {
    const cachedRun = marketUniverseV2Cache.getRun();
    if (cachedRun) return cachedRun;
    const run = await MarketUniverseRunV2.findOne({ where: { active: true, status: 'ACTIVE' }, order: [['generatedAt','DESC']] });
    if (!run) throw Object.assign(new Error('No active Market Universe V2 is available'), { code: 'ACTIVE_MARKET_UNIVERSE_V2_NOT_FOUND', statusCode: 404 });
    marketUniverseV2Cache.setRun(run);
    return run;
  }

  static async getGenerationStatus() {
    const run = await MarketUniverseRunV2.findOne({ where: { status: 'GENERATING' }, order: [['generatedAt','DESC']] });
    if (!run) return { inProgress: false };
    const progressPercentage = Math.max(0, Math.min(100, Number(run.generationProgress || 0)));
    return {
      inProgress: true,
      runId: run.runId,
      progressPercentage,
      currentRecords: Math.floor(Number(run.assetCount || 0) * progressPercentage / 100),
      missingRecords: Math.max(0, Number(run.assetCount || 0) - Math.floor(Number(run.assetCount || 0) * progressPercentage / 100)),
      targetRecords: Number(run.assetCount || 0)
    };
  }

  static async startRegeneration(options = {}) {
    const existing = await MarketUniverseRunV2.findOne({ where: { status: 'GENERATING' }, order: [['generatedAt','DESC']] });
    if (existing) return { accepted: true, alreadyInProgress: true, runId: existing.runId };
    const seed = Number(options.seed ?? 42);
    const pathCount = Number(options.pathCount ?? 1000);
    const monthCount = Number(options.monthCount ?? 360);
    // Persist GENERATING before acknowledging HTTP so polling can never observe
    // a false idle window while factor snapshots/preparation are still running.
    const run = await MarketUniverseRunV2.create({
      seed, pathCount, monthCount, assetCount: 0, assetOrder: [],
      status: 'GENERATING', active: false, generationProgress: 1
    });
    setImmediate(() => this.regenerate({ ...options, seed, pathCount, monthCount, _runId: run.runId }).catch((error) => console.error('[Market Universe V2 regeneration]', error)));
    return { accepted: true, alreadyInProgress: false, version: 2, runId: run.runId };
  }

  static async buildMacroSnapshot(isins) {
    const [etfs, macroStatistics, structuralProbabilities, transitions, inertiaConfigurations, intensityConfigurations, globalProperties, correlations] = await Promise.all([
      ETF.findAll({ where: { isin: { [Op.in]: isins } }, attributes: ['isin','name','nickname'], raw: true }),
      EtfMacroStatistics.findAll({ where: { isin: { [Op.in]: isins } }, raw: true }),
      StructuralProbability.findAll({ raw: true }),
      TransitionMatrix.findAll({ raw: true }),
      ScenarioInertiaConfiguration.findAll({ raw: true }),
      ScenarioIntensityConfiguration.findAll({ raw: true }),
      MonteCarloGlobalProperty.findAll({ raw: true }),
      EtfCorrelation.findAll({ where: { isin1: { [Op.in]: isins }, isin2: { [Op.in]: isins } }, raw: true })
    ]);
    return buildMonteCarloSnapshot({ isins, etfs, macroStatistics, structuralProbabilities, transitions, inertiaConfigurations, intensityConfigurations, globalProperties, correlations });
  }

  static async regenerate({ seed = 42, pathCount = 1000, monthCount = 360, _runId = null } = {}) {
    let run = _runId ? await MarketUniverseRunV2.findByPk(_runId) : null;
    try {
      const factorSnapshotRaw = await FactorMarketUniverseSnapshotService.build();
      const operationalEtfs = factorSnapshotRaw.etfs.filter((etf) =>
        etf.exposures?.length > 0 && etf.specificRisk && ['ready','review_required'].includes(String(etf.validation?.status || ''))
      );
      if (!operationalEtfs.length) throw Object.assign(new Error('No operational Factor Engine V2 ETFs are available'), { code: 'MARKET_UNIVERSE_V2_EMPTY', statusCode: 422 });

      const factorSnapshot = {
        ...factorSnapshotRaw,
        etfs: operationalEtfs.map((etf) => ({ ...etf, ready: true }))
      };
      const assetOrder = operationalEtfs.map((etf) => normalizeIsin(etf.isin));
      // Macro-state generation is global: one calibrated ETF is sufficient to let the
      // legacy snapshot builder validate/normalize the shared Markov/intensity config.
      // V2 ETF returns themselves come exclusively from the factor snapshot below.
      const macroSnapshot = await this.buildMacroSnapshot([assetOrder[0]]);
      let runtime = await import('investment-lab-core');
      if (typeof runtime.generateMonthlyEtfReturnsFromFactors !== 'function') {
        const factorRuntime = await import('investment-lab-core/src/factors/factor-market-universe.js').catch(() => ({}));
        runtime = { ...runtime, ...factorRuntime };
      }
      if (typeof runtime.generateMonthlyEtfReturnsFromFactors !== 'function' || typeof runtime.generateMonthlyMacroTimeline !== 'function') {
        throw Object.assign(new Error('Factor Engine V2 generation runtime is unavailable'), { code: 'MARKET_UNIVERSE_V2_RUNTIME_MISSING', statusCode: 500 });
      }

      if (!run) {
        run = await MarketUniverseRunV2.create({
          seed: Number(seed), pathCount: Number(pathCount), monthCount: Number(monthCount),
          assetCount: operationalEtfs.length, assetOrder, status: 'GENERATING', active: false, generationProgress: 1
        });
      } else {
        await run.update({ assetCount: operationalEtfs.length, assetOrder, generationProgress: 1 });
      }

      const totalValues = Number(pathCount) * Number(monthCount);
      const returnsByIsin = new Map(assetOrder.map((isin) => [isin, new Float32Array(totalValues)]));
      const scenarios = new Uint8Array(totalValues);
      const intensities = new Float32Array(totalValues);

      for (let pathId = 0; pathId < Number(pathCount); pathId += 1) {
        const random = new runtime.SeededRandom(runtime.derivePathSeed(Number(seed), pathId));
        const timeline = runtime.generateMonthlyMacroTimeline(macroSnapshot, Number(monthCount), () => random.next());
        for (let monthIndex = 0; monthIndex < Number(monthCount); monthIndex += 1) {
          const flatIndex = pathId * Number(monthCount) + monthIndex;
          const month = timeline.months[monthIndex];
          scenarios[flatIndex] = scenarioCode(month.scenario);
          intensities[flatIndex] = Number(month.intensity);
          const generated = runtime.generateMonthlyEtfReturnsFromFactors(factorSnapshot, month.scenario, month.intensity, () => random.next());
          for (const entry of generated.etfReturns) {
            const target = returnsByIsin.get(normalizeIsin(entry.isin));
            if (target) target[flatIndex] = Number(entry.monthlyReturn);
          }
        }
        if ((pathId + 1) % 10 === 0 || pathId + 1 === Number(pathCount)) {
          await run.update({ generationProgress: ((pathId + 1) / Number(pathCount)) * 95 });
        }
      }

      const rows = operationalEtfs.map((etf) => {
        const isin = normalizeIsin(etf.isin);
        const vector = returnsByIsin.get(isin);
        return { runId: run.runId, etfId: etf.id, isin, returnsBinary: float32ToBuffer(vector), valueCount: totalValues };
      });
      await MarketUniverseEtfV2.bulkCreate(rows, { validate: true });
      await run.update({
        scenarioBinary: Buffer.from(scenarios),
        intensityBinary: float32ToBuffer(intensities),
        generationProgress: 99,
        status: 'READY'
      });

      const previous = await MarketUniverseRunV2.findOne({ where: { active: true }, order: [['generatedAt','DESC']] });
      if (previous && previous.runId !== run.runId) await previous.update({ active: false, status: 'READY' });
      await run.update({ active: true, status: 'ACTIVE', generationProgress: 100 });
      marketUniverseV2Cache.invalidate();
      marketUniverseV2Cache.setRun(run);
      if (previous && previous.runId !== run.runId) {
        await MarketUniverseEtfV2.destroy({ where: { runId: previous.runId } });
        await previous.destroy();
      }
      return { success: true, version: 2, runId: run.runId, pathCount: Number(pathCount), monthCount: Number(monthCount), assetCount: rows.length, rowCount: rows.length };
    } catch (error) {
      if (run) await run.update({ status: 'FAILED', active: false }).catch(() => {});
      throw error;
    }
  }

  static normalizeHoldings(holdings) {
    const rows = (Array.isArray(holdings) ? holdings : [])
      .map((h) => ({ isin: normalizeIsin(h.isin), weight: Number(h.weight) }))
      .filter((h) => h.isin && Number.isFinite(h.weight) && h.weight > 0);
    const total = rows.reduce((sum, h) => sum + h.weight, 0);
    if (!rows.length || total <= 0) throw Object.assign(new Error('Portfolio requires at least one positive V2 holding'), { code: 'INVALID_MARKET_UNIVERSE_V2_HOLDINGS', statusCode: 400 });
    return rows.map((h) => ({ ...h, weight: h.weight / total }));
  }

  static async buildBinaryPortfolioProjection({ holdings = [] } = {}) {
    const totalStartedAt = process.hrtime.bigint();
    const msSince = (startedAt) => Number(process.hrtime.bigint() - startedAt) / 1e6;
    const normalized = this.normalizeHoldings(holdings);

    const activeRunStartedAt = process.hrtime.bigint();
    const run = await this.getActiveRun();
    const activeRunMs = msSince(activeRunStartedAt);
    marketUniverseV2Cache.ensureRun(run);

    const requestedIsins = normalized.map((h) => h.isin);
    const valuesByIsin = new Map();
    const missingIsins = [];
    let cacheHits = 0;
    for (const isin of requestedIsins) {
      const cached = marketUniverseV2Cache.getEtf(run.runId, isin);
      if (cached) {
        valuesByIsin.set(isin, cached);
        cacheHits += 1;
      } else {
        missingIsins.push(isin);
      }
    }

    const dbStartedAt = process.hrtime.bigint();
    const rows = missingIsins.length > 0 ? await MarketUniverseEtfV2.findAll({
      where: { runId: run.runId, isin: { [Op.in]: missingIsins } },
      attributes: ['isin','returnsBinary','valueCount'],
      raw: true
    }) : [];
    const dbReadMs = msSince(dbStartedAt);
    const bytesRead = rows.reduce((sum, row) => sum + (Buffer.isBuffer(row.returnsBinary) ? row.returnsBinary.length : Buffer.byteLength(row.returnsBinary || [])), 0);

    const rowsByIsin = new Map(rows.map((row) => [normalizeIsin(row.isin), row]));
    const missing = missingIsins.filter((isin) => !rowsByIsin.has(isin));
    if (missing.length) throw Object.assign(new Error(`ETF not present in active Market Universe V2: ${missing.join(', ')}`), { code: 'MISSING_ETF_IN_ACTIVE_MARKET_UNIVERSE_V2', statusCode: 409 });

    const totalValues = Number(run.pathCount) * Number(run.monthCount);
    let decodeAggregateMs = 0;
    for (const isin of missingIsins) {
      const row = rowsByIsin.get(isin);
      const decodeStartedAt = process.hrtime.bigint();
      const values = bufferToFloat32(row.returnsBinary);
      decodeAggregateMs += msSince(decodeStartedAt);
      if (values.length !== totalValues) throw Object.assign(new Error(`Invalid V2 vector geometry for ${isin}`), { code: 'INVALID_MARKET_UNIVERSE_V2_GEOMETRY', statusCode: 409 });
      valuesByIsin.set(isin, values);
      marketUniverseV2Cache.setEtf(run.runId, isin, values);
    }

    const weightedReturns = new Float64Array(totalValues);
    const aggregationStartedAt = process.hrtime.bigint();
    for (const holding of normalized) {
      const values = valuesByIsin.get(holding.isin);
      for (let i = 0; i < totalValues; i += 1) weightedReturns[i] += holding.weight * values[i];
    }
    const aggregateMs = msSince(aggregationStartedAt);

    const macroStartedAt = process.hrtime.bigint();
    const scenarioBuffer = Buffer.isBuffer(run.scenarioBinary) ? run.scenarioBinary : Buffer.from(run.scenarioBinary || []);
    const intensityValues = bufferToFloat32(run.intensityBinary);
    if (scenarioBuffer.length !== totalValues || intensityValues.length !== totalValues) throw Object.assign(new Error('Invalid V2 macro vector geometry'), { code: 'INVALID_MARKET_UNIVERSE_V2_MACRO_GEOMETRY', statusCode: 409 });
    const scenarios = Array.from(scenarioBuffer, decodeScenario);
    const macroDecodeMs = msSince(macroStartedAt);

    const encodeStartedAt = process.hrtime.bigint();
    const binary = encodeMarketUniverseBinary({
      runId: String(run.runId),
      pathCount: Number(run.pathCount),
      monthCount: Number(run.monthCount),
      payloadType: PAYLOAD_TYPE_FULL,
      returns: Array.from(weightedReturns),
      intensities: Array.from(intensityValues),
      scenarios
    });
    const binaryEncodeMs = msSince(encodeStartedAt);
    const totalMs = msSince(totalStartedAt);

    const telemetry = {
      selectedAssetCount: requestedIsins.length,
      cacheHits,
      cacheMisses: missingIsins.length,
      cachedEtfs: marketUniverseV2Cache.status().cachedEtfs,
      cacheMaxEtfs: marketUniverseV2Cache.status().maxEtfs,
      bytesRead,
      responseBytes: binary.length,
      activeRunMs: Number(activeRunMs.toFixed(2)),
      dbReadMs: Number(dbReadMs.toFixed(2)),
      decodeAggregateMs: Number(decodeAggregateMs.toFixed(2)),
      aggregateMs: Number(aggregateMs.toFixed(2)),
      macroDecodeMs: Number(macroDecodeMs.toFixed(2)),
      binaryEncodeMs: Number(binaryEncodeMs.toFixed(2)),
      totalMs: Number(totalMs.toFixed(2))
    };
    console.info('[MU V2 projection telemetry]', telemetry);

    return { buffer: binary, runId: run.runId, version: 2, payloadType: 'FULL', pathCount: Number(run.pathCount), monthCount: Number(run.monthCount), selectedAssetCount: requestedIsins.length, telemetry };
  }
}

module.exports = { MarketUniverseV2Service };
