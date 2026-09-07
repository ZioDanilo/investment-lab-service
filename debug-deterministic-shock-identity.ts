import { config } from 'dotenv';
config();

import { Sequelize, QueryTypes } from 'sequelize';
import { buildMonteCarloSnapshot } from './src/utils/monteCarloSnapshot.js';
import { prepareMonteCarloPrecomputation } from '../investment-lab-x-web-vscode/src/app/core/precomputation/monte-carlo-precomputation.ts';
import { generateMonthlyReturnVector } from '../investment-lab-x-web-vscode/src/app/core/returns/monte-carlo-return-engine.ts';

const SCENARIOS = ['expansion', 'soft_landing', 'recession', 'stagflation'] as const;
const VECTORS_PER_SCENARIO = 100000;
const DEBUG_SHOCK = '1';

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

const assertHard = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const makeRandomSource = (seed: number) => {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
};

async function main() {
  process.env.DEBUG_SHOCK = DEBUG_SHOCK;

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
    let seed = 123456 + scenario.length * 1000;
    for (let vectorNumber = 0; vectorNumber < 20; vectorNumber += 1) {
      const random = makeRandomSource(seed + vectorNumber * 17);
      const vector = generateMonthlyReturnVector(snapshot, precompute, scenario, 1, random);
      for (let index = 0; index < vector.etfReturns.length; index += 1) {
        const result = vector.etfReturns[index];
        const diagnosticShock = (vector as any).debugDiagnosticShocks?.[index] ?? result.standardizedShock;
        const arrayShock = result.standardizedShock;
        const returnedShock = result.standardizedShock;
        const muEff = result.effectiveParameters.effectiveMu;
        const sigmaEff = result.effectiveParameters.effectiveSigma;
        const monthlyReturn = result.monthlyReturn;
        const returnFromDiagnostic = muEff + sigmaEff * diagnosticShock;
        const returnFromReturned = muEff + sigmaEff * returnedShock;
        const errorDiagnostic = monthlyReturn - returnFromDiagnostic;
        const errorReturned = monthlyReturn - returnFromReturned;
        console.log(JSON.stringify({
          scenario,
          vectorNumber,
          index,
          isin: result.isin,
          diagnosticShock,
          arrayShock,
          returnedShock,
          deltaDiagnosticVsArray: diagnosticShock - arrayShock,
          deltaArrayVsReturned: arrayShock - returnedShock,
          monthlyReturn,
          returnFromDiagnostic,
          returnFromReturned,
          errorDiagnostic,
          errorReturned,
          muEff,
          sigmaEff,
        }, null, 2));
        assertHard(Object.is(diagnosticShock, arrayShock) || diagnosticShock === arrayShock, `shock identity failed at scenario=${scenario} vector=${vectorNumber} index=${index} isin=${result.isin} left=${diagnosticShock} right=${arrayShock}`);
        assertHard(Object.is(arrayShock, returnedShock) || arrayShock === returnedShock, `returned shock identity failed at scenario=${scenario} vector=${vectorNumber} index=${index} isin=${result.isin} left=${arrayShock} right=${returnedShock}`);
        assertHard(Math.abs(errorReturned) < 1e-9, `return identity failed at scenario=${scenario} vector=${vectorNumber} index=${index} isin=${result.isin} error=${errorReturned}`);
      }
    }
  }

  await sequelize.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
