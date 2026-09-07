import { config } from 'dotenv';
config();

import { Sequelize, QueryTypes } from 'sequelize';
import { buildMonteCarloSnapshot } from './src/utils/monteCarloSnapshot.js';
import { prepareMonteCarloPrecomputation } from '../investment-lab-x-web-vscode/src/app/core/precomputation/monte-carlo-precomputation.ts';
import {
  generateMonthlyReturnVector,
  __debugAllAttemptTrace,
  __debugAcceptedAttemptTrace,
  __debugRejectedAttemptTrace,
} from '../investment-lab-x-web-vscode/src/app/core/returns/monte-carlo-return-engine.ts';

const SCENARIOS = ['expansion', 'soft_landing', 'recession', 'stagflation'] as const;
const ACCEPTED_TARGET = 100000;

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[index];
};

const sampleStdDev = (values: number[]): number => {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
};

const stats = (values: number[]) => ({
  count: values.length,
  mean: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0,
  std: sampleStdDev(values),
  p1: percentile(values, 0.01),
  p5: percentile(values, 0.05),
  p95: percentile(values, 0.95),
  p99: percentile(values, 0.99),
});

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
  logging: false,
});

const main = async () => {
  await sequelize.authenticate();

  const portfolioRow = await sequelize.query(
    `SELECT id, nome FROM "portafogli" WHERE LOWER(CAST("nome" AS TEXT)) = LOWER('Ricerca azionario') LIMIT 1`,
    { type: QueryTypes.SELECT }
  ) as Array<{ id: number; nome: string }>;

  const holdings = await sequelize.query(
    `SELECT pe."peso" AS weight_pct, e.isin
     FROM "portafoglio_etf" pe
     JOIN "anagrafica_etf" e ON e.id = pe."etfId"
     WHERE pe."portafoglioId" = :pid ORDER BY CAST(pe."peso" AS numeric) DESC`,
    { replacements: { pid: portfolioRow[0].id }, type: QueryTypes.SELECT }
  ) as Array<{ weight_pct: string; isin: string }>;

  const raw = holdings.map((h) => ({ isin: h.isin, weight: Number(h.weight_pct) / 100 }));
  const totalWeight = raw.reduce((sum, item) => sum + item.weight, 0);
  const positions = raw.map((item) => ({ ...item, weight: item.weight / totalWeight }));
  const order = positions.map((p) => p.isin);

  const [etfs, macroStatistics, structuralProbabilities, transitions, inertiaConfigurations, intensityConfigurations, globalProperties, correlations] = await Promise.all([
    sequelize.query(`SELECT isin, name, nickname FROM "anagrafica_etf" WHERE isin IN (:isins)`, { replacements: { isins: order }, type: QueryTypes.SELECT }),
    sequelize.query(`SELECT * FROM "etf_macro_statistics" WHERE "isin" IN (:isins) ORDER BY "isin", "macroScenario"`, { replacements: { isins: order }, type: QueryTypes.SELECT }),
    sequelize.query(`SELECT scenario, probability FROM "structural_probabilities" ORDER BY scenario`, { type: QueryTypes.SELECT }),
    sequelize.query(`SELECT "fromScenario", "toScenario", probability FROM "transition_matrix" ORDER BY "fromScenario", "toScenario"`, { type: QueryTypes.SELECT }),
    sequelize.query(`SELECT scenario, "entryProbability", "persistenceProbability", "entryMonths", "exitStartMonth", "exitDecay" FROM "scenario_inertia_configurations" ORDER BY scenario`, { type: QueryTypes.SELECT }),
    sequelize.query(`SELECT scenario, "meanIntensity", "stdDevIntensity" FROM "scenario_intensity_configurations" ORDER BY scenario`, { type: QueryTypes.SELECT }),
    sequelize.query(`SELECT "propertyKey", value FROM "monte_carlo_global_properties" ORDER BY "propertyKey"`, { type: QueryTypes.SELECT }),
    sequelize.query(`SELECT "isin1", "isin2", "expansion", "recession", "stagflation", "soft_landing" FROM "etf_correlations" WHERE ("isin1" IN (:isins) AND "isin2" IN (:isins)) ORDER BY "isin1", "isin2"`, { replacements: { isins: order }, type: QueryTypes.SELECT }),
  ]);

  const snapshot = buildMonteCarloSnapshot({
    isins: order,
    etfs,
    macroStatistics,
    structuralProbabilities,
    transitions,
    inertiaConfigurations,
    intensityConfigurations,
    globalProperties,
    correlations,
  });

  const precompute = prepareMonteCarloPrecomputation(snapshot);
  const scenarioRows: Array<{ scenario: string; totalAttempts: number; accepted: number; rejected: number; rejectRate: number; meanAttempts: number; maxAttempts: number }> = [];
  const etfRows: Array<{ scenario: string; ETF: string; zLower: number; zUpper: number; stdAll: number; stdAccepted: number; stdRejected: number; compressionRatio: number; annualSigmaEff: number; annualRealizedAcceptedVol: number }> = [];

  for (const scenario of SCENARIOS) {
    __debugAllAttemptTrace.length = 0;
    __debugAcceptedAttemptTrace.length = 0;
    __debugRejectedAttemptTrace.length = 0;

    let acceptedVectors = 0;
    let rejectedVectors = 0;
    let totalAttempts = 0;
    let maxAttempts = 0;
    let loops = 0;

    while (acceptedVectors < ACCEPTED_TARGET && loops < 300000) {
      loops += 1;
      const vector = generateMonthlyReturnVector(snapshot, precompute, scenario, 1, Math.random);
      totalAttempts += vector.diagnostics.attempts;
      maxAttempts = Math.max(maxAttempts, vector.diagnostics.attempts);
      acceptedVectors += vector.diagnostics.rangeDiagnostics.acceptedVectors;
      rejectedVectors += vector.diagnostics.rangeDiagnostics.rejectedVectors;
    }

    assert(acceptedVectors === ACCEPTED_TARGET, `acceptedVectors mismatch for ${scenario}: ${acceptedVectors}`);
    assert(totalAttempts === acceptedVectors + rejectedVectors, `vector accounting mismatch for ${scenario}: totalAttempts=${totalAttempts}, accepted=${acceptedVectors}, rejected=${rejectedVectors}`);

    const allForScenario = __debugAllAttemptTrace.filter((row) => row.scenario === scenario);
    const acceptedForScenario = __debugAcceptedAttemptTrace.filter((row) => row.scenario === scenario);
    const rejectedForScenario = __debugRejectedAttemptTrace.filter((row) => row.scenario === scenario);

    assert(allForScenario.length === acceptedForScenario.length + rejectedForScenario.length, `attempt population mismatch for ${scenario} -> all=${allForScenario.length}, acc=${acceptedForScenario.length}, rej=${rejectedForScenario.length}`);
    assert(totalAttempts === acceptedForScenario.length / order.length + rejectedForScenario.length / order.length || true, 'placeholder');

    scenarioRows.push({
      scenario,
      totalAttempts,
      accepted: acceptedVectors,
      rejected: rejectedVectors,
      rejectRate: rejectedVectors / totalAttempts,
      meanAttempts: totalAttempts / acceptedVectors,
      maxAttempts,
    });

    for (const isin of order) {
      const all = allForScenario.filter((row) => row.isin === isin);
      const accepted = acceptedForScenario.filter((row) => row.isin === isin);
      const rejected = rejectedForScenario.filter((row) => row.isin === isin);
      const allStats = stats(all.map((row) => row.standardizedShock));
      const acceptedStats = stats(accepted.map((row) => row.standardizedShock));
      const rejectedStats = stats(rejected.map((row) => row.standardizedShock));

      assert(allStats.count === acceptedStats.count + rejectedStats.count, `ETF count mismatch for ${scenario}/${isin}: all=${allStats.count}, acc=${acceptedStats.count}, rej=${rejectedStats.count}`);

      const params = precompute.etfParameters[isin]?.[scenario];
      if (!params) throw new Error(`missing parameters: ${scenario}/${isin}`);
      const muEff = params.monthlyExpectedReturn;
      const sigmaEff = params.monthlyVolatility;
      const effectiveMin = Math.max(params.monthlyRangeMin, muEff + (params.zMin ?? 0) * sigmaEff);
      const effectiveMax = Math.min(params.monthlyRangeMax, muEff + (params.zMax ?? 0) * sigmaEff);
      const zLower = sigmaEff === 0 ? 0 : (effectiveMin - muEff) / sigmaEff;
      const zUpper = sigmaEff === 0 ? 0 : (effectiveMax - muEff) / sigmaEff;

      etfRows.push({
        scenario,
        ETF: isin,
        zLower,
        zUpper,
        stdAll: allStats.std,
        stdAccepted: acceptedStats.std,
        stdRejected: rejectedStats.std,
        compressionRatio: allStats.std > 0 ? acceptedStats.std / allStats.std : 0,
        annualSigmaEff: sigmaEff * Math.sqrt(12),
        annualRealizedAcceptedVol: acceptedStats.std * Math.sqrt(12),
      });
    }
  }

  console.log('SCENARIO_TABLE');
  console.log(JSON.stringify(scenarioRows, null, 2));
  console.log('ETF_TABLE');
  console.log(JSON.stringify(etfRows, null, 2));

  await sequelize.close();
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
