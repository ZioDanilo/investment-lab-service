import { config } from 'dotenv';
config();

import { Sequelize, QueryTypes } from 'sequelize';
import { buildMonteCarloSnapshot } from './src/utils/monteCarloSnapshot.js';
import { prepareMonteCarloPrecomputation } from '../investment-lab-x-web-vscode/src/app/core/precomputation/monte-carlo-precomputation.ts';
import { generateMonthlyReturnVector } from '../investment-lab-x-web-vscode/src/app/core/returns/monte-carlo-return-engine.ts';

const SCENARIOS = ['expansion', 'soft_landing', 'recession', 'stagflation'] as const;
const SAMPLE_COUNT_PER_SCENARIO = 100000;

const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
  logging: false,
});

const sampleStdDev = (values: number[]): number => {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
};

const annualize = (value: number): number => value * Math.sqrt(12);

const formatPercent = (value: number): string => `${(value * 100).toFixed(4)}%`;

async function main() {
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

  const byScenario: Record<string, Array<{ isin: string; sigmaEff: number; muEff: number; monthlyReturn: number; standardizedShock: number }>> = {};

  for (const scenario of SCENARIOS) {
    byScenario[scenario] = [];
    for (let i = 0; i < SAMPLE_COUNT_PER_SCENARIO; i += 1) {
      const vector = generateMonthlyReturnVector(snapshot, precompute, scenario, 1, Math.random);
      for (const result of vector.etfReturns) {
        byScenario[scenario].push({
          isin: result.isin,
          sigmaEff: result.effectiveParameters.effectiveSigma,
          muEff: result.effectiveParameters.effectiveMu,
          monthlyReturn: result.monthlyReturn,
          standardizedShock: result.standardizedShock,
        });
      }
    }
  }

  const rows: Array<{
    ETF: string;
    Scenario: string;
    sigmaEffAnnual: number;
    shockStd: number;
    expectedAnnualStd: number;
    realizedAnnualStd: number;
    randomComponentAnnualStd: number;
    ratioRealizedToExpected: number;
    maxAbsoluteError: number;
  }> = [];

  for (const scenario of SCENARIOS) {
    for (const isin of order) {
      const values = byScenario[scenario].filter((row) => row.isin === isin);
      const sigmaEffMonthly = values.reduce((sum, row) => sum + row.sigmaEff, 0) / values.length;
      const shockValues = values.map((row) => row.standardizedShock);
      const returnValues = values.map((row) => row.monthlyReturn);
      const randomComponentValues = values.map((row) => row.monthlyReturn - row.muEff);

      const shockMean = shockValues.reduce((sum, value) => sum + value, 0) / shockValues.length;
      const shockVariance = shockValues.reduce((sum, value) => sum + (value - shockMean) ** 2, 0) / (shockValues.length - 1);
      const shockStd = Math.sqrt(shockVariance);

      const realizedMonthlyStd = sampleStdDev(returnValues);
      const realizedAnnualStd = annualize(realizedMonthlyStd);
      const randomComponentStd = sampleStdDev(randomComponentValues);
      const randomComponentAnnualStd = annualize(randomComponentStd);
      const expectedAnnualStd = annualize(sigmaEffMonthly * shockStd);
      const ratioRealizedToExpected = realizedAnnualStd / expectedAnnualStd;
      const maxAbsoluteError = Math.max(
        ...values.map((row) => Math.abs(row.monthlyReturn - (row.muEff + row.sigmaEff * row.standardizedShock)))
      );

      rows.push({
        ETF: isin,
        Scenario: scenario,
        sigmaEffAnnual: annualize(sigmaEffMonthly),
        shockStd,
        expectedAnnualStd,
        realizedAnnualStd,
        randomComponentAnnualStd,
        ratioRealizedToExpected,
        maxAbsoluteError,
      });
    }
  }

  const verdict = rows.every((row) => Math.abs(row.shockStd - 1) < 0.02 && Math.abs(row.ratioRealizedToExpected - 1) < 0.02)
    ? 'MARGINAL RETURN ENGINE BUG = NO'
    : (rows.every((row) => row.shockStd < 1) ? 'MARGINAL RETURN ENGINE BUG = YES\nSOURCE = standardizedShock' : 'MARGINAL RETURN ENGINE BUG = YES\nSOURCE = return construction');

  console.log('ETF | Scenario | sigmaEffAnnual | shockStd | expectedAnnualStd | realizedAnnualStd | randomComponentAnnualStd | ratioRealizedToExpected');
  for (const row of rows) {
    console.log(
      `${row.ETF} | ${row.Scenario} | ${formatPercent(row.sigmaEffAnnual)} | ${(row.shockStd).toFixed(6)} | ${formatPercent(row.expectedAnnualStd)} | ${formatPercent(row.realizedAnnualStd)} | ${formatPercent(row.randomComponentAnnualStd)} | ${(row.ratioRealizedToExpected).toFixed(6)}`
    );
  }

  console.log('');
  console.log('maxAbsoluteError = ' + rows.reduce((max, row) => Math.max(max, row.maxAbsoluteError), 0).toExponential(6));
  console.log('');
  console.log(verdict);

  await sequelize.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
