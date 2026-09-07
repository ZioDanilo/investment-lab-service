import { config } from 'dotenv';
config();

import { Sequelize, QueryTypes } from 'sequelize';
import { buildMonteCarloSnapshot } from './src/utils/monteCarloSnapshot.js';
import { prepareMonteCarloPrecomputation } from '../investment-lab-x-web-vscode/src/app/core/precomputation/monte-carlo-precomputation.ts';
import { generateMonthlyReturnVector } from '../investment-lab-x-web-vscode/src/app/core/returns/monte-carlo-return-engine.ts';

const SCENARIOS = ['expansion', 'soft_landing', 'recession', 'stagflation'] as const;
const SAMPLE_COUNT_PER_SCENARIO = 4000;

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

const pearsonCorrelation = (x: number[], y: number[]): number => {
  if (x.length !== y.length || x.length < 2) return 0;
  const meanX = x.reduce((sum, value) => sum + value, 0) / x.length;
  const meanY = y.reduce((sum, value) => sum + value, 0) / y.length;
  const numerator = x.reduce((sum, value, idx) => sum + (value - meanX) * (y[idx] - meanY), 0);
  const denominatorX = Math.sqrt(x.reduce((sum, value) => sum + (value - meanX) ** 2, 0));
  const denominatorY = Math.sqrt(y.reduce((sum, value) => sum + (value - meanY) ** 2, 0));
  if (denominatorX === 0 || denominatorY === 0) return 0;
  return numerator / (denominatorX * denominatorY);
};

const sampleCovarianceMatrix = (rows: number[][]): number[][] => {
  const n = rows.length;
  const d = rows[0].length;
  const means = Array(d).fill(0);
  for (const row of rows) {
    for (let i = 0; i < d; i += 1) means[i] += row[i];
  }
  for (let i = 0; i < d; i += 1) means[i] /= n;

  const cov = Array.from({ length: d }, () => Array(d).fill(0));
  for (const row of rows) {
    for (let i = 0; i < d; i += 1) {
      for (let j = 0; j < d; j += 1) {
        cov[i][j] += (row[i] - means[i]) * (row[j] - means[j]);
      }
    }
  }
  for (let i = 0; i < d; i += 1) {
    for (let j = 0; j < d; j += 1) {
      cov[i][j] /= (n - 1);
    }
  }
  return cov;
};

const correlationMatrixFromColumns = (rows: number[][]): number[][] => {
  const d = rows[0].length;
  return Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => {
    const colI = rows.map((row) => row[i]);
    const colJ = rows.map((row) => row[j]);
    return pearsonCorrelation(colI, colJ);
  }));
};

const portfolioVarianceFromCovariance = (cov: number[][], weights: number[]): number => {
  let variance = 0;
  for (let i = 0; i < weights.length; i += 1) {
    for (let j = 0; j < weights.length; j += 1) {
      variance += weights[i] * cov[i][j] * weights[j];
    }
  }
  return variance;
};

async function main() {
  await sequelize.authenticate();

  const portfolioRow = await sequelize.query(
    `SELECT id, nome FROM "portafogli" WHERE LOWER(CAST("nome" AS TEXT)) = LOWER('Ricerca azionario') LIMIT 1`,
    { type: QueryTypes.SELECT }
  );

  const holdings = await sequelize.query(
    `SELECT pe."peso" AS weight_pct, e.isin
     FROM "portafoglio_etf" pe
     JOIN "anagrafica_etf" e ON e.id = pe."etfId"
     WHERE pe."portafoglioId" = :pid ORDER BY CAST(pe."peso" AS numeric) DESC`,
    { replacements: { pid: portfolioRow[0].id }, type: QueryTypes.SELECT }
  );

  const raw = holdings.map((h: any) => ({ isin: h.isin, weight: Number(h.weight_pct) / 100 }));
  const total = raw.reduce((sum, p) => sum + p.weight, 0);
  const positions = raw.map((p) => ({ ...p, weight: p.weight / total }));
  const order = positions.map((p) => p.isin);
  const weights = positions.map((p) => p.weight);

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

  const snapshot = buildMonteCarloSnapshot({ isins: order, etfs, macroStatistics, structuralProbabilities, transitions, inertiaConfigurations, intensityConfigurations, globalProperties, correlations });
  const precompute = prepareMonteCarloPrecomputation(snapshot);

  const monthlyRows: number[][] = [];
  for (const scenario of SCENARIOS) {
    for (let sampleIndex = 0; sampleIndex < SAMPLE_COUNT_PER_SCENARIO; sampleIndex += 1) {
      const vector = generateMonthlyReturnVector(snapshot, precompute, scenario, 1, Math.random);
      monthlyRows.push(vector.etfReturns.map((result) => result.monthlyReturn));
    }
  }

  const realizedAnnualVols = order.map((isin, index) => {
    const columnValues = monthlyRows.map((row) => row[index]);
    return sampleStdDev(columnValues) * Math.sqrt(12);
  });

  const directCorrelationMatrix = correlationMatrixFromColumns(monthlyRows);
  const directCovMonthly = sampleCovarianceMatrix(monthlyRows);
  const directCovAnnual = directCovMonthly.map((row) => row.map((value) => value * 12));
  const portfolioVarianceEmpirical = portfolioVarianceFromCovariance(directCovAnnual, weights);
  const portfolioSigmaEmpirical = Math.sqrt(Math.max(0, portfolioVarianceEmpirical));
  const independentRealized = Math.sqrt(
    weights.reduce((sum, weight, index) => sum + (weight * realizedAnnualVols[index]) ** 2, 0)
  );

  const directRealizedPortfolioSigma = 0.07037871601848743;
  const diffPointsPct = (portfolioSigmaEmpirical - directRealizedPortfolioSigma) * 100;

  console.log(JSON.stringify({
    positionsOrder: positions.map((p, index) => ({ index, isin: p.isin, weight: Number(p.weight.toFixed(12)) })),
    snapshotOrder: snapshot.etfs.map((etf, index) => ({ index, isin: etf.isin })),
    realizedETFVolatilitiesAnnual: order.map((isin, index) => ({
      isin,
      realizedAnnualVolatility: Number((realizedAnnualVols[index] * 100).toFixed(6)),
    })),
    empiricalReturnCorrelationMatrix: directCorrelationMatrix,
    pairwise: [
      { isinA: order[0], isinB: order[1], pearson: directCorrelationMatrix[0][1] },
      { isinA: order[0], isinB: order[2], pearson: directCorrelationMatrix[0][2] },
      { isinA: order[1], isinB: order[2], pearson: directCorrelationMatrix[1][2] },
    ],
    empiricalReturnCovarianceMatrixMonthly: directCovMonthly,
    empiricalReturnCovarianceMatrixAnnualized: directCovAnnual,
    realizedETFIndependentSigmaAnnual: Number((independentRealized * 100).toFixed(6)),
    portfolioSigmaFromEmpiricalCovarianceAnnual: Number((portfolioSigmaEmpirical * 100).toFixed(6)),
    directRealizedPortfolioSigmaAnnual: Number((directRealizedPortfolioSigma * 100).toFixed(6)),
    differenceCovarianceDirectPointsPct: Number((diffPointsPct * 100).toFixed(6)),
    sanityCheck: {
      allCorrelationsPositive: directCorrelationMatrix[0][1] > 0 && directCorrelationMatrix[0][2] > 0 && directCorrelationMatrix[1][2] > 0,
      empiricalCorrelatedSigma_ge_independent: portfolioSigmaEmpirical >= independentRealized,
    },
    sampleSize: monthlyRows.length,
  }, null, 2));

  await sequelize.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
