const { Op } = require('sequelize');
const { performance } = require('node:perf_hooks');
const ETF = require('../models/ETF');
const EtfMacroStatistics = require('../models/EtfMacroStatistics');
const StructuralProbability = require('../models/StructuralProbability');
const TransitionMatrix = require('../models/TransitionMatrix');
const ScenarioInertiaConfiguration = require('../models/ScenarioInertiaConfiguration');
const ScenarioIntensityConfiguration = require('../models/ScenarioIntensityConfiguration');
const MonteCarloGlobalProperty = require('../models/MonteCarloGlobalProperty');
const MarketUniverseRunV2 = require('../models/MarketUniverseRunV2');
const MarketUniverseEtfV2 = require('../models/MarketUniverseEtfV2');
const { FactorMarketUniverseSnapshotService } = require('./factorMarketUniverseSnapshotService');
const { buildMonteCarloV3Audit } = require('./monteCarloV3AuditService');
const { calculateMomentValidation } = require('./monteCarloMomentValidationService');
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
  static async getFactorAudit() {
    const snapshotRaw = await FactorMarketUniverseSnapshotService.build();
    const operationalEtfs = snapshotRaw.etfs.filter((etf) =>
      etf.exposures?.length > 0 && etf.specificRisk &&
      ['ready', 'review_required'].includes(String(etf.validation?.status || ''))
    );
    const runtime = await import('investment-lab-core');
    if (typeof runtime.auditFactorMarketUniverse !== 'function') {
      throw Object.assign(new Error('Updated investment-lab-core audit export is unavailable'), {
        code: 'FACTOR_AUDIT_RUNTIME_MISSING', statusCode: 503
      });
    }
    const report = runtime.auditFactorMarketUniverse({
      ...snapshotRaw,
      etfs: operationalEtfs.map(etf => ({ ...etf, ready: true }))
    });
    return {
      ...report,
      generatedAt: new Date().toISOString(),
      factorCount: snapshotRaw.factors.length,
      etfCount: operationalEtfs.length
    };
  }


  // Read-only diagnostics on the persisted active run. No generation, writes or cache mutation.
  static async getMonteCarloDiagnostics() {
    const diagnosticStarted = performance.now();
    const run = await this.getActiveRun();
    const pathCount = Number(run.pathCount);
    const monthCount = Number(run.monthCount);
    const total = pathCount * monthCount;
    if (!Number.isSafeInteger(total) || total <= 0 || pathCount < 1 || monthCount < 2) {
      throw Object.assign(new Error('Invalid active run geometry'), { statusCode: 409, code: 'INVALID_DIAGNOSTIC_GEOMETRY' });
    }
    const scenarioBytes = Buffer.from(run.scenarioBinary || []);
    const intensity = bufferToFloat32(run.intensityBinary);
    if (scenarioBytes.length !== total || intensity.length !== total) {
      throw Object.assign(new Error('Invalid macro timeline geometry'), { statusCode: 409, code: 'INVALID_DIAGNOSTIC_MACRO' });
    }
    const counts = SCENARIOS.map((scenario) => ({ scenario, months: 0, share: 0, spells: 0, meanSpellMonths: 0, maxSpellMonths: 0, meanIntensity: 0 }));
    const spellLengths = SCENARIOS.map(() => []);
    let invalidIntensities = 0;
    for (let p = 0; p < pathCount; p++) {
      let previous = -1, length = 0;
      for (let m = 0; m < monthCount; m++) {
        const k = p * monthCount + m;
        const sc = scenarioBytes[k];
        if (sc >= SCENARIOS.length) throw Object.assign(new Error('Unknown scenario code'), { statusCode: 409, code: 'INVALID_DIAGNOSTIC_SCENARIO' });
        counts[sc].months++;
        if (Number.isFinite(intensity[k])) counts[sc].meanIntensity += intensity[k];
        else invalidIntensities++;
        if (sc === previous) length++;
        else {
          if (previous >= 0) spellLengths[previous].push(length);
          previous = sc; length = 1;
        }
      }
      if (previous >= 0) spellLengths[previous].push(length);
    }
    counts.forEach((c, i) => {
      c.share = c.months / total;
      c.meanIntensity /= c.months || 1;
      c.spells = spellLengths[i].length;
      c.meanSpellMonths = spellLengths[i].reduce((a, b) => a + b, 0) / (c.spells || 1);
      c.maxSpellMonths = spellLengths[i].reduce((max, length) => Math.max(max, length), 0);
    });
    const quantile = (values, q) => {
      if (!values.length) return null;
      const ordered = values.slice().sort((a, b) => a - b);
      const index = (ordered.length - 1) * q;
      const low = Math.floor(index), high = Math.ceil(index);
      return ordered[low] + (ordered[high] - ordered[low]) * (index - low);
    };
    const beforeDbRead = performance.now();
    const rows = await MarketUniverseEtfV2.findAll({
      where: { runId: run.runId }, attributes: ['isin', 'returnsBinary', 'valueCount'], raw: true
    });
    const afterDbRead = performance.now();
    const etfs = [];
    const vectors = new Map();
    for (const row of rows) {
      const isin = normalizeIsin(row.isin);
      const v = bufferToFloat32(row.returnsBinary);
      if (v.length !== total || Number(row.valueCount) !== total) {
        throw Object.assign(new Error('Invalid ETF vector geometry: ' + isin), { statusCode: 409, code: 'INVALID_DIAGNOSTIC_ETF_GEOMETRY' });
      }
      let sum = 0, sum2 = 0, invalid = 0, positive = 0;
      const byScenario = SCENARIOS.map(() => ({ n: 0, sum: 0, sum2: 0 }));
      const cagr = [], drawdown = [];
      const monthlyLosses = [];
      for (let p = 0; p < pathCount; p++) {
        let wealth = 1, peak = 1, worst = 0;
        for (let m = 0; m < monthCount; m++) {
          const k = p * monthCount + m;
          const value = v[k];
          if (!Number.isFinite(value) || value <= -1) {
            invalid++; continue;
          }
          sum += value; sum2 += value * value;
          monthlyLosses.push(value);
          const bucket = byScenario[scenarioBytes[k]];
          bucket.n++; bucket.sum += value; bucket.sum2 += value * value;
          wealth *= 1 + value;
          peak = Math.max(peak, wealth);
          worst = Math.min(worst, wealth / peak - 1);
        }
        const annualGrowth = Math.pow(wealth, 12 / monthCount) - 1;
        cagr.push(annualGrowth);
        drawdown.push(worst);
        if (wealth > 1) positive++;
      }
      monthlyLosses.sort((a, b) => a - b);
      const expectedShortfall = (tail) => {
        const count = Math.max(1, Math.ceil(monthlyLosses.length * tail));
        let lossSum = 0;
        for (let k = 0; k < count; k++) lossSum += monthlyLosses[k];
        return lossSum / count;
      };
      const n = total - invalid, mean = sum / (n || 1);
      const vol = Math.sqrt(Math.max(0, sum2 / (n || 1) - mean * mean) * 12);
      etfs.push({
        isin, invalidReturns: invalid, meanMonthlyReturn: mean,
        arithmeticAnnualReturn: mean * 12, realizedAnnualVolatility: vol,
        cagr: { p05: quantile(cagr, .05), p50: quantile(cagr, .5), p95: quantile(cagr, .95) },
        maxDrawdown: { p01: quantile(drawdown, .01), p05: quantile(drawdown, .05), p50: quantile(drawdown, .5) },
        probabilityPositive: positive / pathCount,
        monthlyExpectedShortfall: { es95: expectedShortfall(.05), es99: expectedShortfall(.01) },
        byScenario: byScenario.map((b, i) => {
          const mu = b.sum / (b.n || 1);
          return { scenario: SCENARIOS[i], months: b.n, annualizedMeanReturn: mu * 12,
            annualizedVolatility: Math.sqrt(Math.max(0, b.sum2 / (b.n || 1) - mu * mu) * 12) };
        })
      });
      vectors.set(isin, v);
    }
    // Pairwise realized correlations; retain all pairs for reproducibility.
    const correlations = [];
    const orderedIsins = etfs.map(e => e.isin);
    for (let i = 0; i < orderedIsins.length; i++) {
      const a = vectors.get(orderedIsins[i]);
      for (let j = i + 1; j < orderedIsins.length; j++) {
        const b = vectors.get(orderedIsins[j]);
        let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
        for (let k = 0; k < total; k++) {
          const x = a[k], y = b[k];
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          n++; sx += x; sy += y; sxx += x*x; syy += y*y; sxy += x*y;
        }
        const covariance = sxy - sx * sy / (n || 1);
        const denom = Math.sqrt(Math.max(0, (sxx - sx*sx/(n||1)) * (syy - sy*sy/(n||1))));
        correlations.push({ isinA: orderedIsins[i], isinB: orderedIsins[j],
          correlation: denom > 0 ? Math.max(-1, Math.min(1, covariance / denom)) : null });
      }
    }
    // Conditional correlations expose diversification breakdowns hidden by pooled averages.
    const conditionalCorrelations = [];
    for (let i = 0; i < orderedIsins.length; i++) {
      const a = vectors.get(orderedIsins[i]);
      for (let j = i + 1; j < orderedIsins.length; j++) {
        const b = vectors.get(orderedIsins[j]);
        for (let sc = 0; sc < SCENARIOS.length; sc++) {
          let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
          for (let k = 0; k < total; k++) {
            if (scenarioBytes[k] !== sc) continue;
            const x = a[k], y = b[k];
            if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
            n++; sx += x; sy += y; sxx += x*x; syy += y*y; sxy += x*y;
          }
          const dx = sxx - sx*sx/(n||1), dy = syy - sy*sy/(n||1);
          conditionalCorrelations.push({ isinA: orderedIsins[i], isinB: orderedIsins[j],
            scenario: SCENARIOS[sc], observations: n,
            correlation: n > 2 && dx > 0 && dy > 0 ? Math.max(-1, Math.min(1, (sxy-sx*sy/n)/Math.sqrt(dx*dy))) : null });
        }
      }
    }
    // Identify indistinguishable factor specifications before changing calibration.
    const factorSpecificationWarnings = [];
    const factorSnapshot = await FactorMarketUniverseSnapshotService.build();
    const signature = (etf) => JSON.stringify({
      exposures: (etf.exposures || []).map(e => [String(e.factorId), Number(e.beta)]).sort((a,b)=>a[0].localeCompare(b[0])),
      alpha: Number(etf.specificRisk?.alpha || 0),
      residualVolatility: Number(etf.specificRisk?.residualVolatility ?? etf.specificRisk?.annualizedVolatility ?? 0)
    });
    const activeIsins = new Set(orderedIsins);
    const matching = factorSnapshot.etfs.filter(e => activeIsins.has(normalizeIsin(e.isin)));
    for (let i = 0; i < matching.length; i++) {
      for (let j = i+1; j < matching.length; j++) {
        if (signature(matching[i]) === signature(matching[j])) {
          factorSpecificationWarnings.push({ code: 'IDENTICAL_FACTOR_SPECIFICATION',
            isinA: normalizeIsin(matching[i].isin), isinB: normalizeIsin(matching[j].isin),
            note: 'Identical current factor exposures, alpha and residual volatility; independent residual draws can still produce different paths.' });
        }
      }
    }
    const stylePremiaWarnings = factorSnapshot.factors
      .filter(f => ['VALUE','MOMENTUM','QUALITY','LOW_VOLATILITY','GROWTH'].includes(String(f.code).toUpperCase()) &&
        f.returnMode === 'compounded_return')
      .map(f => ({ code: 'VERIFY_INCREMENTAL_STYLE_PREMIUM', factorCode: f.code,
        note: 'Confirm that expected returns are incremental premiums rather than full equity returns.' }));
    const beforeV3 = performance.now();
    const v3Audit = await buildMonteCarloV3Audit({
      factorSnapshot,
      etfs, correlations, conditionalCorrelations, scenarios: counts,
      scenarioBytes, pathCount, monthCount
    });
    const beforeV4 = performance.now();
    const v4Validation = calculateMomentValidation({
      snapshot: factorSnapshot, etfs, correlations, scenarioBytes, intensity, run
    });
    const diagnosticFinished = performance.now();
    return {
      version: 4, v3Audit, v4Validation,
      performance: { totalMs: Math.round(diagnosticFinished - diagnosticStarted),
        dbReadMs: Math.round(afterDbRead - beforeDbRead),
        simulationAnalysisMs: Math.round(beforeV3 - afterDbRead),
        economicAuditMs: Math.round(beforeV4 - beforeV3),
        momentValidationMs: Math.round(diagnosticFinished - beforeV4) },
      generatedAt: new Date().toISOString(), source: 'persisted_active_market_universe_v2',
      readOnly: true, run: { runId: run.runId, seed: run.seed, pathCount, monthCount,
        generatedAt: run.generatedAt, assetCount: run.assetCount },
      conventions: {
        returns: 'simple monthly returns in EUR only if source vectors were generated in EUR',
        volatility: 'sampled pooled monthly standard deviation times sqrt(12)',
        cagr: 'per-path terminal geometric annualized return, quantiles across paths',
        drawdown: 'per-path peak-to-trough decline, quantiles across paths',
        scenarioMean: 'arithmetic monthly mean times 12; not a geometric CAGR',
        correlations: 'Pearson on pooled simulated monthly returns; includes macro-regime variation',
        caveat: 'Diagnostics describe persisted simulations, not theoretical factor targets or historical calibration.'
      },
      scenarios: counts, invalidIntensities, etfs, correlations, conditionalCorrelations,
      factorSpecificationWarnings, stylePremiaWarnings
    };
  }

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
    if (!run) {
      const latest = await MarketUniverseRunV2.findOne({ order: [['generatedAt', 'DESC']] });
      return { inProgress: false, runId: latest?.runId || null, status: latest?.status || null, assetCount: Number(latest?.assetCount || 0) };
    }
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
    const [etfs, macroStatistics, structuralProbabilities, transitions, inertiaConfigurations, intensityConfigurations, globalProperties] = await Promise.all([
      ETF.findAll({ where: { isin: { [Op.in]: isins } }, attributes: ['isin','name','nickname'], raw: true }),
      EtfMacroStatistics.findAll({ where: { isin: { [Op.in]: isins } }, raw: true }),
      StructuralProbability.findAll({ raw: true }),
      TransitionMatrix.findAll({ raw: true }),
      ScenarioInertiaConfiguration.findAll({ raw: true }),
      ScenarioIntensityConfiguration.findAll({ raw: true }),
      MonteCarloGlobalProperty.findAll({ raw: true })
    ]);
    return buildMonteCarloSnapshot({ isins, etfs, macroStatistics, structuralProbabilities, transitions, inertiaConfigurations, intensityConfigurations, globalProperties, correlations: [] });
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
      // This single-ETF macro snapshot needs no ETF-pair correlations; V2 return
      // dependence is generated exclusively by the factor engine below.
      const macroSnapshot = await this.buildMacroSnapshot([assetOrder[0]]);
      let runtime = await import('investment-lab-core');
      if (typeof runtime.generateMonthlyEtfReturnsFromFactors !== 'function') {
        const factorRuntime = await import('investment-lab-core/src/factors/factor-market-universe.js').catch(() => ({}));
        runtime = { ...runtime, ...factorRuntime };
      }
      if (typeof runtime.generateMonthlyEtfReturnsFromFactors !== 'function' || typeof runtime.generateMonthlyMacroTimeline !== 'function' || typeof runtime.auditFactorMarketUniverse !== 'function') {
        throw Object.assign(new Error('Factor Engine V2 generation runtime is unavailable'), { code: 'MARKET_UNIVERSE_V2_RUNTIME_MISSING', statusCode: 500 });
      }

      // Fail before allocating or writing any ETF return vectors when the
      // factor correlation matrices or exposures are structurally invalid.
      const factorAudit = runtime.auditFactorMarketUniverse(factorSnapshot);
      console.info('[MU V2 factor preflight]', {
        valid: factorAudit.valid,
        checkedEtfScenarios: factorAudit.etfs.length,
        errors: factorAudit.errors,
        warnings: factorAudit.warnings
      });
      if (!factorAudit.valid) {
        throw Object.assign(new Error('Factor Market Universe preflight failed'), {
          code: 'MARKET_UNIVERSE_V2_FACTOR_PREFLIGHT_FAILED',
          statusCode: 422,
          details: factorAudit.errors
        });
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
            const value = Number(entry.monthlyReturn);
            if (!Number.isFinite(value) || value <= -1) {
              throw Object.assign(new Error('Invalid ETF monthly return generated; refusing to persist a non-compoundable simulation'), {
                code: 'INVALID_GENERATED_ETF_RETURN',
                statusCode: 422,
                details: { isin: entry.isin, pathId, monthIndex, value }
              });
            }
            if (target) target[flatIndex] = value;
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
      // Keep the previous completed run for reproducible before/after comparisons.
      // Only the newest run is active; historical run data remain immutable.
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
