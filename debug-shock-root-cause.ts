import { config } from 'dotenv';
config();

import { Sequelize, QueryTypes } from 'sequelize';
import { buildMonteCarloSnapshot } from './src/utils/monteCarloSnapshot.js';
import { prepareMonteCarloPrecomputation } from '../investment-lab-x-web-vscode/src/app/core/precomputation/monte-carlo-precomputation.ts';
import {
  sampleStandardNormal,
  sampleChiSquare5,
  studentTCdf,
  studentTQuantile,
  STUDENT_T_STANDARDIZATION,
  T_COPULA_DOF,
} from '../investment-lab-x-web-vscode/src/app/core/probability/monte-carlo-probability.ts';

const SCENARIOS = ['expansion', 'soft_landing', 'recession', 'stagflation'] as const;
const SAMPLE_COUNT = 200000;

const sampleStdDev = (values: number[]): number => {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
};

const covarianceDiag = (rows: number[][]): number[] => {
  const d = rows[0].length;
  const means = Array(d).fill(0);
  for (const row of rows) for (let i = 0; i < d; i += 1) means[i] += row[i];
  for (let i = 0; i < d; i += 1) means[i] /= rows.length;
  const variances = Array(d).fill(0);
  for (const row of rows) for (let i = 0; i < d; i += 1) variances[i] += (row[i] - means[i]) ** 2;
  for (let i = 0; i < d; i += 1) variances[i] /= rows.length - 1;
  return variances;
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

  for (const scenario of SCENARIOS) {
    const matrixPreparation = precompute.correlationMatrices[scenario];
    const factor = matrixPreparation.factor;
    const assetIsins = matrixPreparation.assetIsins;

    const G: number[][] = [];
    const Y: number[][] = [];
    const W: number[] = [];
    const rawT: number[][] = [];
    const U: number[][] = [];
    const inverseT: number[][] = [];
    const finalStandardizedShock: number[][] = [];
    let cdfClampCount = 0;
    let inverseErrorMax = 0;
    let inverseErrorSum = 0;
    let inverseErrorCount = 0;

    for (let i = 0; i < SAMPLE_COUNT; i += 1) {
      const independentNormals = assetIsins.map(() => sampleStandardNormal(Math.random));
      const correlatedNormals = factor.map((row) => row.reduce((sum, value, idx) => sum + value * independentNormals[idx], 0));
      const chiSquare = 2 * (() => {
        const shape = T_COPULA_DOF / 2;
        const d = shape - 1 / 3;
        const c = 1 / Math.sqrt(9 * d);
        while (true) {
          const normal = sampleStandardNormal(Math.random);
          const candidate = 1 + c * normal;
          if (candidate <= 0) continue;
          const cube = candidate * candidate * candidate;
          const uniform = Math.random();
          if (uniform < 1 - 0.0331 * normal ** 4 || Math.log(1 - uniform) < 0.5 * normal * normal + d * (1 - cube + Math.log(cube))) {
            return d * cube;
          }
        }
      })();

      G.push(independentNormals);
      Y.push(correlatedNormals);
      W.push(chiSquare);

      const rawTRow = correlatedNormals.map((normal) => normal / Math.sqrt(chiSquare / 5));
      const uRow = rawTRow.map((value) => {
        const p = studentTCdf(value);
        if (p <= Number.EPSILON || p >= 1 - Number.EPSILON) cdfClampCount += 1;
        return Math.min(1 - 1e-12, Math.max(1e-12, p));
      });
      rawT.push(rawTRow);
      U.push(uRow);

      const inverseRow = uRow.map((u) => studentTQuantile(u));
      inverseT.push(inverseRow);
      const finalRow = inverseRow.map((value) => value * STUDENT_T_STANDARDIZATION);
      finalStandardizedShock.push(finalRow);

      for (let idx = 0; idx < rawTRow.length; idx += 1) {
        const inverseError = Math.abs(inverseRow[idx] - rawTRow[idx]);
        inverseErrorMax = Math.max(inverseErrorMax, inverseError);
        inverseErrorSum += inverseError;
        inverseErrorCount += 1;
      }
    }

    const yDiag = covarianceDiag(Y);
    const wMean = W.reduce((sum, value) => sum + value, 0) / W.length;
    const wVariance = W.reduce((sum, value) => sum + (value - wMean) ** 2, 0) / (W.length - 1);
    const wStd = Math.sqrt(wVariance);

    console.log(`SCENARIO ${scenario}`);
    console.log(`factorDim=${factor.length} assetIsins=${assetIsins.length}`);
    console.log(`Y variance diag: ${yDiag.map(v => v.toFixed(6)).join(' | ')}`);
    console.log(`W mean=${wMean.toFixed(6)} variance=${wVariance.toFixed(6)} std=${wStd.toFixed(6)} P1=${Array.from(W).sort((a,b)=>a-b)[Math.floor(W.length * 0.01)].toFixed(6)} P5=${Array.from(W).sort((a,b)=>a-b)[Math.floor(W.length * 0.05)].toFixed(6)} P50=${Array.from(W).sort((a,b)=>a-b)[Math.floor(W.length * 0.50)].toFixed(6)} P95=${Array.from(W).sort((a,b)=>a-b)[Math.floor(W.length * 0.95)].toFixed(6)} P99=${Array.from(W).sort((a,b)=>a-b)[Math.floor(W.length * 0.99)].toFixed(6)}`);
    console.log(`cdfClampCount=${cdfClampCount} cdfClampRate=${(cdfClampCount / (SAMPLE_COUNT * assetIsins.length)).toFixed(12)}`);
    console.log(`maxAbsoluteInverseError=${inverseErrorMax.toExponential(6)} meanAbsoluteInverseError=${(inverseErrorSum / inverseErrorCount).toExponential(6)}`);

    for (let idx = 0; idx < assetIsins.length; idx += 1) {
      const gCol = G.map((row) => row[idx]);
      const yCol = Y.map((row) => row[idx]);
      const rawTCol = rawT.map((row) => row[idx]);
      const inverseTCol = inverseT.map((row) => row[idx]);
      const finalCol = finalStandardizedShock.map((row) => row[idx]);
      const gStd = sampleStdDev(gCol);
      const yStd = sampleStdDev(yCol);
      const rawTStd = sampleStdDev(rawTCol);
      const inverseTStd = sampleStdDev(inverseTCol);
      const finalStd = sampleStdDev(finalCol);
      console.log(`${assetIsins[idx]} | stdG=${gStd.toFixed(6)} | stdY=${yStd.toFixed(6)} | stdRawT=${rawTStd.toFixed(6)} | stdInverseT=${inverseTStd.toFixed(6)} | finalScalingFactor=${STUDENT_T_STANDARDIZATION.toFixed(12)} | stdFinal=${finalStd.toFixed(6)}`);
    }
    console.log('');
  }

  await sequelize.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
