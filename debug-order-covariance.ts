import { config } from 'dotenv';
config();

import { Sequelize, QueryTypes } from 'sequelize';
import { buildMonteCarloSnapshot } from './src/utils/monteCarloSnapshot.js';
import { prepareMonteCarloPrecomputation } from '../investment-lab-x-web-vscode/src/app/core/precomputation/monte-carlo-precomputation.ts';
import { generateMonthlyReturnVector } from '../investment-lab-x-web-vscode/src/app/core/returns/monte-carlo-return-engine.ts';
import { SeededRandom } from '../investment-lab-x-web-vscode/src/app/core/engines/seeded-random.ts';

const scenarios = ['expansion', 'soft_landing', 'recession', 'stagflation'] as const;
const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
  logging: false,
});

const pearsonMatrix = (samples: number[][]): number[][] => {
  const n = samples.length;
  const d = samples[0].length;
  const means = Array(d).fill(0);
  for (const row of samples) {
    for (let i = 0; i < d; i += 1) means[i] += row[i];
  }
  for (let i = 0; i < d; i += 1) means[i] /= n;
  const cov = Array.from({ length: d }, () => Array(d).fill(0));
  for (const row of samples) {
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
  return Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => {
    const denom = Math.sqrt(cov[i][i] * cov[j][j]);
    return denom === 0 ? 0 : cov[i][j] / denom;
  }));
};

const portfolioSigmaFromCorrelation = (matrix: number[][], weights: Record<string, number>, sigmaByIsin: Record<string, number>, order: string[]): number => {
  const variance = order.reduce((sum, isinI, i) => {
    const wI = weights[isinI];
    const sigmaI = sigmaByIsin[isinI];
    return sum + order.reduce((inner, isinJ, j) => {
      const wJ = weights[isinJ];
      const sigmaJ = sigmaByIsin[isinJ];
      return inner + wI * sigmaI * matrix[i][j] * sigmaJ * wJ;
    }, 0);
  }, 0);
  return Math.sqrt(Math.max(0, variance));
};

const computeIndependentSigma = (weights: Record<string, number>, sigmaByIsin: Record<string, number>, order: string[]): number => {
  const variance = order.reduce((sum, isin) => sum + (weights[isin] * sigmaByIsin[isin]) ** 2, 0);
  return Math.sqrt(Math.max(0, variance));
};

const scenarioName = 'expansion';

async function main() {
  await sequelize.authenticate();
  const portfolioRow = await sequelize.query(
    `SELECT id, nome FROM "portafogli" WHERE LOWER(CAST("nome" AS TEXT)) = LOWER('Ricerca azionario') LIMIT 1`,
    { type: QueryTypes.SELECT }
  );
  const holdings = await sequelize.query(
    `SELECT pe."peso" AS weight_pct, e.isin FROM "portafoglio_etf" pe JOIN "anagrafica_etf" e ON e.id = pe."etfId" WHERE pe."portafoglioId" = :pid ORDER BY CAST(pe."peso" AS numeric) DESC`,
    { replacements: { pid: portfolioRow[0].id }, type: QueryTypes.SELECT }
  );

  const raw = holdings.map((h: any) => ({ isin: h.isin, weight: Number(h.weight_pct) / 100 }));
  const total = raw.reduce((sum, p) => sum + p.weight, 0);
  const positions = raw.map((p) => ({ ...p, weight: p.weight / total }));
  const isins = positions.map((p) => p.isin);

  const [etfs, macroStatistics, structuralProbabilities, transitions, inertiaConfigurations, intensityConfigurations, globalProperties, correlations] = await Promise.all([
    sequelize.query(`SELECT isin, name, nickname FROM "anagrafica_etf" WHERE isin IN (:isins)`, { replacements: { isins }, type: QueryTypes.SELECT }),
    sequelize.query(`SELECT * FROM "etf_macro_statistics" WHERE "isin" IN (:isins) ORDER BY "isin", "macroScenario"`, { replacements: { isins }, type: QueryTypes.SELECT }),
    sequelize.query(`SELECT scenario, probability FROM "structural_probabilities" ORDER BY scenario`, { type: QueryTypes.SELECT }),
    sequelize.query(`SELECT "fromScenario", "toScenario", probability FROM "transition_matrix" ORDER BY "fromScenario", "toScenario"`, { type: QueryTypes.SELECT }),
    sequelize.query(`SELECT scenario, "entryProbability", "persistenceProbability", "entryMonths", "exitStartMonth", "exitDecay" FROM "scenario_inertia_configurations" ORDER BY scenario`, { type: QueryTypes.SELECT }),
    sequelize.query(`SELECT scenario, "meanIntensity", "stdDevIntensity" FROM "scenario_intensity_configurations" ORDER BY scenario`, { type: QueryTypes.SELECT }),
    sequelize.query(`SELECT "propertyKey", value FROM "monte_carlo_global_properties" ORDER BY "propertyKey"`, { type: QueryTypes.SELECT }),
    sequelize.query(`SELECT "isin1", "isin2", "expansion", "recession", "stagflation", "soft_landing" FROM "etf_correlations" WHERE ("isin1" IN (:isins) AND "isin2" IN (:isins)) ORDER BY "isin1", "isin2"`, { replacements: { isins }, type: QueryTypes.SELECT }),
  ]);

  const snapshot = buildMonteCarloSnapshot({ isins, etfs, macroStatistics, structuralProbabilities, transitions, inertiaConfigurations, intensityConfigurations, globalProperties, correlations });
  const precompute = prepareMonteCarloPrecomputation(snapshot);
  const order = precompute.correlationMatrices[scenarioName].assetIsins;
  const weightByIsin = Object.fromEntries(positions.map((p) => [p.isin, p.weight]));
  const sigmaByIsin = Object.fromEntries(order.map((isin) => [isin, Math.sqrt(12) * precompute.etfParameters[isin][scenarioName].monthlyVolatility]));

  const independentAnnualSigma = computeIndependentSigma(weightByIsin, sigmaByIsin, order);

  const operationalMatrix = precompute.correlationMatrices[scenarioName].operationalMatrix;
  const operationalAnnualSigma = portfolioSigmaFromCorrelation(operationalMatrix, weightByIsin, sigmaByIsin, order);

  const samples: number[][] = [];
  for (let idx = 0; idx < 20000; idx += 1) {
    const vector = generateMonthlyReturnVector(snapshot, precompute, scenarioName, 1, () => new SeededRandom(10000 + idx).next());
    samples.push(vector.etfReturns.map((item) => item.standardizedShock));
  }

  const empiricalShockMatrix = pearsonMatrix(samples);
  const empiricalAnnualSigma = portfolioSigmaFromCorrelation(empiricalShockMatrix, weightByIsin, sigmaByIsin, order);

  const pairRows: any[] = [];
  for (let i = 0; i < order.length; i += 1) {
    for (let j = 0; j < order.length; j += 1) {
      if (i === j) continue;
      const isinI = order[i];
      const isinJ = order[j];
      const rho = operationalMatrix[i][j];
      const cov = rho * sigmaByIsin[isinI] * sigmaByIsin[isinJ];
      const contribution = weightByIsin[isinI] * cov * weightByIsin[isinJ];
      pairRows.push({
        isinA: isinI,
        isinB: isinJ,
        weightA: weightByIsin[isinI],
        weightB: weightByIsin[isinJ],
        sigmaA: sigmaByIsin[isinI],
        sigmaB: sigmaByIsin[isinJ],
        rhoAB: rho,
        covarianceAB: cov,
        varianceContribution: contribution,
      });
    }
  }

  const diagonalVariance = order.reduce((sum, isin) => sum + (weightByIsin[isin] * sigmaByIsin[isin]) ** 2, 0);
  const crossCovarianceContribution = pairRows.reduce((sum, row) => sum + 2 * row.varianceContribution, 0);
  const totalVariance = diagonalVariance + crossCovarianceContribution;
  const totalSigma = Math.sqrt(Math.max(0, totalVariance));

  console.log(JSON.stringify({
    positionsOrder: positions.map((p, index) => ({ index, isin: p.isin, weight: p.weight })),
    snapshotOrder: snapshot.etfs.map((etf, index) => ({ index, isin: etf.isin })),
    vectorOrder: generateMonthlyReturnVector(snapshot, precompute, scenarioName, 1, () => new SeededRandom(12345).next()).etfReturns.map((r, index) => ({ index, isin: r.isin })),
    correlationMatrixOrder: order.map((isin, index) => ({ index, isin })),
    sigmaByIsin: Object.fromEntries(Object.entries(sigmaByIsin).map(([isin, sigma]) => [isin, Number(sigma.toFixed(12))])),
    weightByIsin: Object.fromEntries(Object.entries(weightByIsin).map(([isin, weight]) => [isin, Number(weight.toFixed(12))])),
    independentAnnualSigma: Number(independentAnnualSigma.toFixed(12)),
    independentAnnualSigmaPercent: Number((independentAnnualSigma * 100).toFixed(6)),
    operationalCorrelationPredictedAnnualSigma: Number(operationalAnnualSigma.toFixed(12)),
    operationalCorrelationPredictedAnnualSigmaPercent: Number((operationalAnnualSigma * 100).toFixed(6)),
    empiricalShockCorrelationPredictedAnnualSigma: Number(empiricalAnnualSigma.toFixed(12)),
    empiricalShockCorrelationPredictedAnnualSigmaPercent: Number((empiricalAnnualSigma * 100).toFixed(6)),
    realizedAnnualSigma: 0.07037871601848743,
    realizedAnnualSigmaPercent: 7.037871601848743,
    empiricalShockCorrelationMatrix: empiricalShockMatrix,
    operationalCorrelationMatrix: operationalMatrix,
    pairRows: pairRows.slice(0, 6),
    diagonalVariance: Number(diagonalVariance.toFixed(12)),
    crossCovarianceContribution: Number(crossCovarianceContribution.toFixed(12)),
    totalVariance: Number(totalVariance.toFixed(12)),
    totalSigma: Number(totalSigma.toFixed(12)),
    check: {
      correlatedSigmaGeIndependent: totalSigma >= independentAnnualSigma,
      empiricalCorrelationSigmaGeIndependent: empiricalAnnualSigma >= independentAnnualSigma,
      independentSigmaAnnual: independentAnnualSigma,
      correlatedSigmaAnnual: totalSigma,
      empiricalShockSigmaAnnual: empiricalAnnualSigma,
    },
  }, null, 2));

  await sequelize.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
