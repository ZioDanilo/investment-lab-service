const { FactorMarketUniverseSnapshotService } = require('./factorMarketUniverseSnapshotService');

class FactorMarketUniverseService {
  static async getReadiness() {
    const snapshot = await FactorMarketUniverseSnapshotService.build();
    const pending = snapshot.etfs.filter(etf => !etf.ready).map(etf => ({
      id: etf.id,
      isin: etf.isin,
      name: etf.name,
      status: etf.validation?.status || 'pending',
      hasExposures: etf.exposures.length > 0,
      hasSpecificRisk: Boolean(etf.specificRisk)
    }));
    return {
      engine: 'factor',
      version: 2,
      ready: pending.length === 0 && snapshot.totalEtfCount > 0,
      factorCount: snapshot.factors.length,
      totalEtfCount: snapshot.totalEtfCount,
      readyEtfCount: snapshot.readyEtfCount,
      pendingEtfCount: pending.length,
      pending
    };
  }

  static async preview(options = {}) {
    const snapshot = await FactorMarketUniverseSnapshotService.build(options);
    return {
      version: snapshot.version,
      engine: snapshot.engine,
      factorCount: snapshot.factors.length,
      factorOrder: snapshot.factorOrder,
      factorCodes: snapshot.factorCodes,
      totalEtfCount: snapshot.totalEtfCount,
      readyEtfCount: snapshot.readyEtfCount,
      etfs: snapshot.etfs.map(etf => ({
        id: etf.id, isin: etf.isin, name: etf.name, ready: etf.ready,
        validation: etf.validation,
        exposureCount: etf.exposures.length,
        specificRisk: etf.specificRisk
      })),
      generatedAt: snapshot.generatedAt
    };
  }

  static async generateSample({ scenario = 'expansion', intensity = 0.5, seed = 42 } = {}) {
    const snapshot = await FactorMarketUniverseSnapshotService.build();
    let runtime = await import('investment-lab-core');
    if (typeof runtime.generateMonthlyEtfReturnsFromFactors !== 'function') {
      // The backend can temporarily run with an older installed file: dependency.
      // Load the V2 module directly when the package root has not been refreshed yet.
      runtime = await import('investment-lab-core/src/factors/factor-market-universe.js').catch(() => runtime);
    }
    if (typeof runtime.generateMonthlyEtfReturnsFromFactors !== 'function') {
      const error = new Error('Factor Engine V2 runtime is not installed in investment-lab-core. Refresh/reinstall the local core dependency.');
      error.statusCode = 500;
      throw error;
    }
    let state = Number(seed) >>> 0;
    const random = () => {
      state = (Math.imul(1664525, state) + 1013904223) >>> 0;
      return state / 4294967296;
    };
    const result = runtime.generateMonthlyEtfReturnsFromFactors(snapshot, scenario, intensity, random);
    return { scenario, intensity: Number(intensity), seed: Number(seed), ...result };
  }
  static async statisticalTest({ scenario = 'expansion', intensity = 0.5, seed = 42, samples = 100000 } = {}) {
    const snapshot = await FactorMarketUniverseSnapshotService.build();
    const runtime = await import('investment-lab-core');
    if (typeof runtime.generateMonthlyFactorReturns !== 'function') {
      const error = new Error('Factor Engine V2 statistical runtime is not installed in investment-lab-core.');
      error.statusCode = 500;
      throw error;
    }

    const n = Math.max(1000, Math.min(250000, Number(samples) || 100000));
    let state = Number(seed) >>> 0;
    const random = () => {
      state = (Math.imul(1664525, state) + 1013904223) >>> 0;
      return state / 4294967296;
    };

    const ids = snapshot.factorOrder;
    const m = ids.length;
    const sums = new Float64Array(m);
    const sumsSq = new Float64Array(m);
    const cross = Array.from({ length: m }, () => new Float64Array(m));

    for (let s = 0; s < n; s += 1) {
      const returns = runtime.generateMonthlyFactorReturns(snapshot, scenario, intensity, random);
      const values = ids.map(id => Number(returns[id]));
      for (let i = 0; i < m; i += 1) {
        const x = values[i];
        sums[i] += x;
        sumsSq[i] += x * x;
        for (let j = 0; j < i; j += 1) cross[i][j] += x * values[j];
      }
    }

    const observedMeans = Array.from(sums, x => x / n);
    const observedVars = Array.from(sumsSq, (x, i) => Math.max(0, x / n - observedMeans[i] ** 2));
    const observedVols = observedVars.map(Math.sqrt);
    const factorResults = snapshot.factors.map((factor, i) => {
      const general = factor.statistics.general;
      const stressed = factor.statistics[scenario];
      const annualMean = Number(general.expectedReturn) + (Number(stressed.expectedReturn) - Number(general.expectedReturn)) * Number(intensity);
      const annualVol = Math.max(0, Number(general.volatility) + (Number(stressed.volatility) - Number(general.volatility)) * Number(intensity));
      const expectedMean = Math.pow(1 + annualMean, 1 / 12) - 1;
      const expectedVol = annualVol / Math.sqrt(12);
      return {
        factorId: factor.id, code: factor.code,
        expectedMonthlyMean: expectedMean, observedMonthlyMean: observedMeans[i],
        meanError: observedMeans[i] - expectedMean,
        expectedMonthlyVolatility: expectedVol, observedMonthlyVolatility: observedVols[i],
        volatilityError: observedVols[i] - expectedVol
      };
    });

    const persisted = snapshot.correlations[scenario] || {};
    const correlationResults = [];
    for (let i = 0; i < m; i += 1) {
      for (let j = 0; j < i; j += 1) {
        const covariance = cross[i][j] / n - observedMeans[i] * observedMeans[j];
        const observed = covariance / (observedVols[i] * observedVols[j]);
        const key = [String(ids[i]), String(ids[j])].sort().join(':');
        const expected = Number(persisted[key]);
        correlationResults.push({
          factor1Id: ids[i], factor2Id: ids[j], expected, observed,
          error: observed - expected, absoluteError: Math.abs(observed - expected)
        });
      }
    }

    const meanZ = factorResults.map(x => Math.abs(x.meanError) / (x.expectedMonthlyVolatility / Math.sqrt(n)));
    const volRel = factorResults.map(x => Math.abs(x.volatilityError) / Math.max(x.expectedMonthlyVolatility, 1e-12));
    const corrAbs = correlationResults.map(x => x.absoluteError);
    const maxMeanZ = Math.max(...meanZ);
    const maxVolatilityRelativeError = Math.max(...volRel);
    const meanCorrelationAbsoluteError = corrAbs.reduce((a,b) => a+b, 0) / corrAbs.length;
    const maxCorrelationAbsoluteError = Math.max(...corrAbs);
    const thresholds = { maxMeanZ: 5, maxVolatilityRelativeError: 0.02, meanCorrelationAbsoluteError: 0.01, maxCorrelationAbsoluteError: 0.03 };
    const pass = maxMeanZ <= thresholds.maxMeanZ
      && maxVolatilityRelativeError <= thresholds.maxVolatilityRelativeError
      && meanCorrelationAbsoluteError <= thresholds.meanCorrelationAbsoluteError
      && maxCorrelationAbsoluteError <= thresholds.maxCorrelationAbsoluteError;

    return {
      pass, scenario, intensity: Number(intensity), seed: Number(seed), samples: n,
      factorCount: m, correlationCount: correlationResults.length,
      metrics: { maxMeanZ, maxVolatilityRelativeError, meanCorrelationAbsoluteError, maxCorrelationAbsoluteError },
      thresholds,
      factors: factorResults,
      worstCorrelations: correlationResults.sort((a,b) => b.absoluteError - a.absoluteError).slice(0, 20)
    };
  }
}

module.exports = { FactorMarketUniverseService };
