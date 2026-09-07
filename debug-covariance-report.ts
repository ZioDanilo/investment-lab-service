import { config } from 'dotenv';
config();

import { Sequelize, QueryTypes } from 'sequelize';
import { buildMonteCarloSnapshot } from './src/utils/monteCarloSnapshot.js';
import { prepareMonteCarloPrecomputation } from '../investment-lab-x-web-vscode/src/app/core/precomputation/monte-carlo-precomputation.ts';
import { generateMonthlyReturnVector } from '../investment-lab-x-web-vscode/src/app/core/returns/monte-carlo-return-engine.ts';
import { SeededRandom } from '../investment-lab-x-web-vscode/src/app/core/engines/seeded-random.ts';
import { sampleChiSquare5, sampleStandardNormal, studentTCdf, studentTQuantile, STUDENT_T_STANDARDIZATION } from '../investment-lab-x-web-vscode/src/app/core/probability/monte-carlo-probability.ts';

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

const covMatrix = (samples: number[][]): number[][] => {
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
  return cov;
};

const vectorToMatrix = (vector: number[]) => [vector];

async function main() {
  await sequelize.authenticate();

  const portfolioRow = await sequelize.query(
    `SELECT id, nome FROM "portafogli" WHERE LOWER(CAST("nome" AS TEXT)) = LOWER('Ricerca azionario') LIMIT 1`,
    { type: QueryTypes.SELECT }
  );

  if (!portfolioRow[0]) throw new Error('Portfolio not found');

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

  const sigmaEffObserved = [0.03917690398437226, 0.032989444798403066, 0.036911240402836006];
  const sigmaEffMatrixDiagonal = sigmaEffObserved.map((sigma) => sigma);

  const scenarioSummary: Record<string, any> = {};
  const weightedCovariance = Array.from({ length: 3 }, () => Array(3).fill(0));
  const scenarioProb = { expansion: 0.4, soft_landing: 0.2, recession: 0.2, stagflation: 0.2 };

  for (const scenario of scenarios) {
    const rng = new SeededRandom(10000 + scenario.length * 9973);
    const samples: number[][] = [];
    for (let index = 0; index < 20000; index += 1) {
      const vector = generateMonthlyReturnVector(snapshot, precompute, scenario, 1, () => rng.next());
      samples.push(vector.etfReturns.map((entry) => entry.standardizedShock));
    }

    const empiricalRho = pearsonMatrix(samples);
    const empiricalCov = covMatrix(samples);
    const operational = precompute.correlationMatrices[scenario].operationalMatrix;

    const offDiagOps: number[] = [];
    const offDiagEmp: number[] = [];
    const diffs: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      for (let j = i + 1; j < 3; j += 1) {
        offDiagOps.push(operational[i][j]);
        offDiagEmp.push(empiricalRho[i][j]);
        diffs.push(Math.abs(operational[i][j] - empiricalRho[i][j]));
      }
    }

    const pairRows: any[] = [];
    for (let i = 0; i < 3; i += 1) {
      for (let j = i + 1; j < 3; j += 1) {
        pairRows.push({
          pair: `${i + 1}-${j + 1}`,
          operationalRho: operational[i][j],
          empiricalRho: empiricalRho[i][j],
          empiricalCovariance: empiricalCov[i][j],
          delta: empiricalRho[i][j] - operational[i][j],
        });
      }
    }

    const mae = diffs.reduce((sum, value) => sum + value, 0) / diffs.length;
    const rmse = Math.sqrt(diffs.reduce((sum, value) => sum + value * value, 0) / diffs.length);
    const maxAbsError = Math.max(...diffs);

    const averageCorrelation = (matrix: number[][]) => {
      let total = 0;
      let count = 0;
      for (let i = 0; i < matrix.length; i += 1) {
        for (let j = 0; j < matrix.length; j += 1) {
          if (i !== j) {
            total += matrix[i][j];
            count += 1;
          }
        }
      }
      return count === 0 ? 0 : total / count;
    };

    scenarioSummary[scenario] = {
      operational: operational,
      empiricalShock: empiricalRho,
      pairRows,
      maeOffDiagonal: mae,
      rmseOffDiagonal: rmse,
      maxAbsErrorOffDiagonal: maxAbsError,
      empiricalCovariance: empiricalCov,
      avgOffDiagonalOperational: averageCorrelation(operational),
      avgOffDiagonalEmpirical: averageCorrelation(empiricalRho),
    };

    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        weightedCovariance[i][j] += scenarioProb[scenario] * empiricalCov[i][j];
      }
    }
  }

  const portfolioSigmaFromCov = (cov: number[][], weights: number[], sigmaEff: number[]) => {
    const variance = weights.reduce((sum, wi, i) => {
      return sum + weights.reduce((inner, wj, j) => {
        return inner + wi * sigmaEff[i] * cov[i][j] * sigmaEff[j] * wj;
      }, 0);
    }, 0);
    return Math.sqrt(Math.max(0, variance));
  };

  const weights = positions.map((p) => p.weight);
  const sigmaEff = [0.03917690398437226, 0.032989444798403066, 0.036911240402836006];
  const empiricalSigmaMonthly = portfolioSigmaFromCov(weightedCovariance, weights, sigmaEff);
  const empiricalSigmaAnnual = empiricalSigmaMonthly * Math.sqrt(12);

  console.log(JSON.stringify({
    portfolioWeights: positions,
    operationalMatrices: Object.fromEntries(scenarios.map((scenario) => [scenario, precompute.correlationMatrices[scenario].operationalMatrix])),
    scenarioResults: scenarioSummary,
    portfolio: {
      operationalTheoreticalSigmaAnnual: 0.12441868225440804,
      empiricalShockCovariancePredictedPortfolioSigmaMonthly: empiricalSigmaMonthly,
      empiricalShockCovariancePredictedPortfolioSigmaAnnual: empiricalSigmaAnnual,
      realizedPortfolioSigmaAnnual: 0.07037871601848743,
      ratioToRealized: empiricalSigmaAnnual / 0.07037871601848743,
    }
  }, null, 2));

  await sequelize.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
