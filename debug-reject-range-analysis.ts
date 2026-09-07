import { config } from 'dotenv';
config();

import { Sequelize, QueryTypes } from 'sequelize';
import { buildMonteCarloSnapshot } from './src/utils/monteCarloSnapshot.js';
import { prepareMonteCarloPrecomputation } from '../investment-lab-x-web-vscode/src/app/core/precomputation/monte-carlo-precomputation.ts';
import { generateMonthlyReturnVector, __debugRejectTrace, __debugAcceptTrace } from '../investment-lab-x-web-vscode/src/app/core/returns/monte-carlo-return-engine.ts';

const SCENARIOS = ['expansion', 'soft_landing', 'recession', 'stagflation'] as const;
const SAMPLE_COUNT = 100000;

const sampleStdDev = (values: number[]): number => {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
};

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[index];
};

const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
  logging: false,
});

async function main() {
  process.env.DEBUG_REJECT = '1';
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
  const total = raw.reduce((sum, p) => sum + p.weight, 0);
  const positions = raw.map((p) => ({ ...p, weight: p.weight / total }));
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

  const allRejects: Array<typeof __debugRejectTrace[number]> = [];
  const allAccepted: Array<typeof __debugAcceptTrace[number]> = [];

  for (const scenario of SCENARIOS) {
    let acceptedVectors = 0;
    let rejectedVectors = 0;
    let attempts = 0;
    let maxRedraws = 0;
    for (let i = 0; i < SAMPLE_COUNT; i += 1) {
      const vector = generateMonthlyReturnVector(snapshot, precompute, scenario, 1, Math.random);
      attempts += 1;
      if (vector.diagnostics.rangeDiagnostics) {
        acceptedVectors += vector.diagnostics.rangeDiagnostics.acceptedVectors;
        rejectedVectors += vector.diagnostics.rangeDiagnostics.rejectedVectors;
      }
      maxRedraws = Math.max(maxRedraws, vector.diagnostics.attempts);
    }

    const rejectsForScenario = __debugRejectTrace.filter((row) => row.scenario === scenario);
    const acceptedForScenario = __debugAcceptTrace.filter((row) => row.scenario === scenario);
    allRejects.push(...rejectsForScenario);
    allAccepted.push(...acceptedForScenario);

    console.log('SCENARIO', scenario);
    console.log({
      requestedAcceptedVectors: SAMPLE_COUNT,
      totalAttempts: attempts,
      acceptedVectors: acceptedVectors,
      rejectedVectors: rejectedVectors,
      rejectRate: rejectedVectors / (acceptedVectors + rejectedVectors),
      meanRedrawsPerAcceptedVector: acceptedVectors > 0 ? attempts / acceptedVectors : 0,
      maxRedrawsObserved: maxRedraws,
    });

    const byIsin = new Map<string, { before: number[]; after: number[] }>();
    for (const row of rejectsForScenario) {
      if (!byIsin.has(row.isin)) byIsin.set(row.isin, { before: [], after: [] });
      byIsin.get(row.isin)!.before.push(row.shock);
    }
    for (const row of acceptedForScenario) {
      if (!byIsin.has(row.isin)) byIsin.set(row.isin, { before: [], after: [] });
      byIsin.get(row.isin)!.after.push(row.shock);
    }

    for (const isin of order) {
      const stats = byIsin.get(isin) ?? { before: [], after: [] };
      const beforeStd = sampleStdDev(stats.before);
      const afterStd = sampleStdDev(stats.after);
      console.log({
        isin,
        beforeSampleCount: stats.before.length,
        afterSampleCount: stats.after.length,
        beforeMean: stats.before.length ? stats.before.reduce((s, x) => s + x, 0) / stats.before.length : 0,
        beforeStd,
        beforeP1: stats.before.length ? percentile(stats.before, 0.01) : 0,
        beforeP5: stats.before.length ? percentile(stats.before, 0.05) : 0,
        beforeP95: stats.before.length ? percentile(stats.before, 0.95) : 0,
        beforeP99: stats.before.length ? percentile(stats.before, 0.99) : 0,
        afterMean: stats.after.length ? stats.after.reduce((s, x) => s + x, 0) / stats.after.length : 0,
        afterStd,
        afterP1: stats.after.length ? percentile(stats.after, 0.01) : 0,
        afterP5: stats.after.length ? percentile(stats.after, 0.05) : 0,
        afterP95: stats.after.length ? percentile(stats.after, 0.95) : 0,
        afterP99: stats.after.length ? percentile(stats.after, 0.99) : 0,
        compressionRatio: beforeStd > 0 ? afterStd / beforeStd : 0,
      });
    }
    console.log('');
  }

  await sequelize.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
