import { config } from 'dotenv';
config();

import { fileURLToPath } from 'url';
import { Sequelize, QueryTypes } from 'sequelize';
import { buildMonteCarloSnapshot } from './src/utils/monteCarloSnapshot.js';
import { prepareMonteCarloPrecomputation } from '../investment-lab-x-web-vscode/src/app/core/precomputation/monte-carlo-precomputation.ts';
import { generateMonthlyReturnVector } from '../investment-lab-x-web-vscode/src/app/core/returns/monte-carlo-return-engine.ts';
import {
  sampleStandardNormal,
  sampleChiSquare5,
  studentTCdf,
  studentTQuantile,
  STUDENT_T_STANDARDIZATION,
} from '../investment-lab-x-web-vscode/src/app/core/probability/monte-carlo-probability.ts';

const SCENARIOS = ['expansion', 'soft_landing', 'recession', 'stagflation'] as const;
const VECTOR_COUNT = 2000;

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

const makeSequenceRandom = (values: number[]) => {
  let index = 0;
  return () => {
    if (index >= values.length) {
      throw new Error(`random sequence exhausted at index ${index}`);
    }
    return values[index++];
  };
};

const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
  logging: false,
});

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

  // Show actual module paths used by this process.
  const enginePath = fileURLToPath(new URL('../investment-lab-x-web-vscode/src/app/core/returns/monte-carlo-return-engine.ts', import.meta.url));
  const probabilityPath = fileURLToPath(new URL('../investment-lab-x-web-vscode/src/app/core/probability/monte-carlo-probability.ts', import.meta.url));
  const precomputePath = fileURLToPath(new URL('../investment-lab-x-web-vscode/src/app/core/precomputation/monte-carlo-precomputation.ts', import.meta.url));
  console.log('MODULE_PATHS');
  console.log({ enginePath, probabilityPath, precomputePath });

  for (const scenario of SCENARIOS) {
    const matrixPreparation = precompute.correlationMatrices[scenario];
    const factor = matrixPreparation.factor;
    const assetIsins = matrixPreparation.assetIsins;
    const internalShocks: number[][] = [];
    const returnedShocks: number[][] = [];
    const deltas: number[][] = [];
    const maxAbsError = { internal: 0, returned: 0 };

    for (let vectorIndex = 0; vectorIndex < VECTOR_COUNT; vectorIndex += 1) {
      const sequence = [] as number[];
      for (let j = 0; j < 100000; j += 1) {
        sequence.push(Math.random());
      }

      const rngA = makeSequenceRandom(sequence);
      const vector = generateMonthlyReturnVector(snapshot, precompute, scenario, 1, rngA);

      const rngB = makeSequenceRandom([...sequence]);
      const independentNormals = assetIsins.map(() => sampleStandardNormal(rngB));
      const correlatedNormals = factor.map((row) => row.reduce((sum, value, idx) => sum + value * independentNormals[idx], 0));
      const commonChiSquare = sampleChiSquare5(rngB);
      const internalRow = correlatedNormals.map((normal) => {
        const correlatedT = normal / Math.sqrt(commonChiSquare / 5);
        const probability = clamp(studentTCdf(correlatedT));
        const shock = studentTQuantile(probability) * STUDENT_T_STANDARDIZATION;
        return shock;
      });
      internalShocks.push(internalRow);
      returnedShocks.push(vector.etfReturns.map((item) => item.standardizedShock));
      const deltaRow = vector.etfReturns.map((item, idx) => item.standardizedShock - internalRow[idx]);
      deltas.push(deltaRow);
      for (let idx = 0; idx < internalRow.length; idx += 1) {
        const internalError = Math.abs(internalRow[idx] - vector.etfReturns[idx].standardizedShock);
        const returnError = Math.abs((vector.etfReturns[idx].muEff + vector.etfReturns[idx].sigmaEff * internalRow[idx]) - vector.etfReturns[idx].monthlyReturn);
        if (internalError > maxAbsError.internal) maxAbsError.internal = internalError;
        if (returnError > maxAbsError.returned) maxAbsError.returned = returnError;
      }
    }

    const internalFlat = internalShocks.flat();
    const returnedFlat = returnedShocks.flat();
    const deltasFlat = deltas.flat();

    console.log('SCENARIO', scenario);
    console.log({
      stdInternal: sampleStdDev(internalFlat),
      stdReturned: sampleStdDev(returnedFlat),
      meanAbsDelta: deltasFlat.reduce((sum, value) => sum + Math.abs(value), 0) / deltasFlat.length,
      maxAbsDelta: deltasFlat.reduce((max, value) => Math.max(max, Math.abs(value)), 0),
      correlation: pearsonCorrelation(internalFlat, returnedFlat),
      maxAbsError,
    });
  }

  await sequelize.close();
}

function clamp(value: number): number {
  return Math.min(1 - 1e-12, Math.max(1e-12, value));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
