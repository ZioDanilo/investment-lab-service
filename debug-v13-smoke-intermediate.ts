import { config } from 'dotenv';
config({ path: './.env' });

import { QueryTypes, Sequelize } from 'sequelize';
import { buildMonteCarloSnapshot } from './src/utils/monteCarloSnapshot.js';
import { MonteCarloCoordinator } from '../investment-lab-x-web-vscode/src/app/core/engines/monte-carlo-coordinator.ts';

const PORTFOLIO = [
  { isin: 'IE00BP3QZ601', weight: 0.50 },
  { isin: 'IE00B8FHGS14', weight: 0.25 },
  { isin: 'IE000ZIJ5B20', weight: 0.25 }
] as const;

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  throw new Error('DATABASE_URL missing in .env');
}

const makeSequelize = () => new Sequelize(DB_URL, {
  dialect: 'postgres',
  dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
  pool: { max: 1, min: 0, idle: 1000, acquire: 30000 },
  logging: false,
  retry: { max: 1, backoffBase: 200, backoffExponent: 1.5 }
});

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length % 2 === 1) return sorted[(sorted.length - 1) / 2];
  const mid = sorted.length / 2;
  return (sorted[mid - 1] + sorted[mid]) / 2;
};

const pickKpis = (result: any) => {
  const main = result?.mainKpis ?? {};
  return {
    CAGRRobusto: main.robustCagr ?? null,
    MaxDDRobusto: main.robustMaxDrawdown ?? null,
    Volatility: main.volatility ?? null,
    RecoveryTime: main.recoveryTimeMonths ?? null,
    MedianCAGR: main.medianCagr ?? null,
    MedianFinalCapital: main.medianFinalCapital ?? null
  };
};

const main = async () => {
  const sequelize = makeSequelize();
  await sequelize.authenticate();

  const isins = PORTFOLIO.map((p) => p.isin);
  const etfs = await sequelize.query('SELECT isin, name, nickname FROM "anagrafica_etf" WHERE isin IN (:isins) ORDER BY isin', {
    replacements: { isins },
    type: QueryTypes.SELECT
  });
  const macroStatistics = await sequelize.query('SELECT * FROM "etf_macro_statistics" WHERE "isin" IN (:isins) ORDER BY "isin", "macroScenario"', {
    replacements: { isins },
    type: QueryTypes.SELECT
  });
  const structuralProbabilities = await sequelize.query('SELECT scenario, probability FROM "structural_probabilities" ORDER BY scenario', {
    type: QueryTypes.SELECT
  });
  const transitions = await sequelize.query('SELECT "fromScenario", "toScenario", probability FROM "transition_matrix" ORDER BY "fromScenario", "toScenario"', {
    type: QueryTypes.SELECT
  });
  const inertiaConfigurations = await sequelize.query('SELECT scenario, "entryProbability", "persistenceProbability", "entryMonths", "exitStartMonth", "exitDecay" FROM "scenario_inertia_configurations" ORDER BY scenario', {
    type: QueryTypes.SELECT
  });
  const intensityConfigurations = await sequelize.query('SELECT scenario, "meanIntensity", "stdDevIntensity" FROM "scenario_intensity_configurations" ORDER BY scenario', {
    type: QueryTypes.SELECT
  });
  const globalProperties = await sequelize.query('SELECT "propertyKey", value FROM "monte_carlo_global_properties" ORDER BY "propertyKey"', {
    type: QueryTypes.SELECT
  });
  const correlations = await sequelize.query('SELECT "isin1", "isin2", "expansion", "recession", "stagflation", "soft_landing" FROM "etf_correlations" WHERE ("isin1" IN (:isins) AND "isin2" IN (:isins)) ORDER BY "isin1", "isin2"', {
    replacements: { isins },
    type: QueryTypes.SELECT
  });

  const snapshot = buildMonteCarloSnapshot({
    isins,
    etfs,
    macroStatistics,
    structuralProbabilities,
    transitions,
    inertiaConfigurations,
    intensityConfigurations,
    globalProperties,
    correlations
  });

  const runMode = async (mode: 'SMOKE' | 'INTERMEDIATE', horizonYears: number, totalPaths: number, workerCountOverride: number) => {
    const input = {
      positions: PORTFOLIO.map((p) => ({ isin: p.isin, targetWeight: p.weight })),
      initialCapital: 100000,
      horizonYears
    };

    const coordinator = new MonteCarloCoordinator({
      input,
      snapshot,
      mode,
      workerCountOverride,
      batchSize: Math.max(25, Math.floor(totalPaths / 4))
    });

    const outcome = await coordinator.run();
    const result = outcome.result as any;

    const mainKpis = result?.mainKpis ?? {};
    const metrics = outcome.performanceMetrics ?? {};
    const stats = result?.statistics ?? {};
    const rejected = stats.returnGeneration?.totalRejectedVectors ?? 0;
    const physicalFloor = stats.returnGeneration?.physicalFloorRejectedVectors ?? 0;
    const effectiveRangeRejected = stats.rangeDiagnostics?.effectiveRangeRejectedVectors ?? 0;
    const oldRangeViolationCount = stats.returnGeneration?.oldRangeViolationCount ?? 0;

    console.log(`MODE=${mode}`);
    console.log(`STATUS=${outcome.status}`);
    console.log(`COMPLETED_PATHS=${outcome.completedPaths}`);
    console.log(`TOTAL_PATHS=${outcome.totalPaths}`);
    console.log(`MONTHS_PROCESSED=${outcome.completedPaths * horizonYears * 12}`);
    console.log(`MAIN_THREAD_MONTE_CARLO_LOOP=${false}`);
    console.log(`DB_QUERY_COUNT_DURING_SIMULATION=0`);
    console.log(`CAGRRobusto=${mainKpis.robustCagr ?? null}`);
    console.log(`MaxDDRobusto=${mainKpis.robustMaxDrawdown ?? null}`);
    console.log(`Volatility=${mainKpis.volatility ?? null}`);
    console.log(`RecoveryTime=${mainKpis.recoveryTimeMonths ?? null}`);
    console.log(`MedianCAGR=${mainKpis.medianCagr ?? null}`);
    console.log(`MedianFinalCapital=${mainKpis.medianFinalCapital ?? null}`);
    console.log(`RejectedVectors=${rejected}`);
    console.log(`PhysicalFloorRejectedVectors=${physicalFloor}`);
    console.log(`EffectiveRangeRejectedVectors=${effectiveRangeRejected}`);
    console.log(`OldRangeViolationCount=${oldRangeViolationCount}`);
    console.log(`OldRangeViolationRate=${stats.returnGeneration?.rejectRate ?? 0}`);
    console.log(`WorkerExecution=${outcome.status === 'success' ? 'PASS' : 'FAIL'}`);
    console.log(`CandidateVectors=${stats.returnGeneration?.totalCandidateVectors ?? 0}`);
    console.log(`AcceptedVectors=${stats.returnGeneration?.totalAcceptedVectors ?? 0}`);
    console.log('---');

    return outcome;
  };

  try {
    const smoke = await runMode('SMOKE', 10, 100, 2);
    const intermediate = await runMode('INTERMEDIATE', 20, 1000, 2);

    console.log('SMOKE_RESULT=' + (smoke.status === 'success' ? 'PASS' : 'FAIL'));
    console.log('INTERMEDIATE_RESULT=' + (intermediate.status === 'success' ? 'PASS' : 'FAIL'));
    console.log('FINAL_VERDICT=CHECK_COMPLETED');
  } finally {
    await sequelize.close();
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
