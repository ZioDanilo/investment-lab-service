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
}

module.exports = { FactorMarketUniverseService };
