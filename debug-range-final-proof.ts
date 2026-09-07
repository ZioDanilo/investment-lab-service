import { config } from 'dotenv';
config();

import { Sequelize, QueryTypes } from 'sequelize';
import { buildMonteCarloSnapshot } from './src/utils/monteCarloSnapshot.js';
import { prepareMonteCarloPrecomputation } from '../investment-lab-x-web-vscode/src/app/core/precomputation/monte-carlo-precomputation.ts';
import { generateMonthlyReturnVector, __debugAllAttemptTrace } from '../investment-lab-x-web-vscode/src/app/core/returns/monte-carlo-return-engine.ts';

const SCENARIOS = ['expansion', 'soft_landing', 'recession', 'stagflation'] as const;
const ACCEPTED_TARGET = 20000;

const sampleStdDev = (values: number[]): number => {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
};

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

  const table1: Array<{ scenario: string; totalAttempts: number; acceptedVectors: number; rejectedVectors: number; rejectRate: number; meanAttemptsPerAccepted: number }> = [];
  const table2: Array<{ scenario: string; ETF: string; annualSigmaEff: number; zLower: number; zUpper: number; stdAllShock: number; stdAcceptedShock: number; stdRejectedShock: number; compressionRatio: number; annualAcceptedReturnVol: number; expectedAcceptedReturnVol: number }> = [];

  for (const scenario of SCENARIOS) {
    __debugAllAttemptTrace.length = 0;

    let acceptedVectors = 0;
    let rejectedVectors = 0;
    let totalAttempts = 0;
    let maxAttempts = 0;

    while (acceptedVectors < ACCEPTED_TARGET) {
      const vector = generateMonthlyReturnVector(snapshot, precompute, scenario, 1, Math.random);
      totalAttempts += vector.diagnostics.attempts;
      maxAttempts = Math.max(maxAttempts, vector.diagnostics.attempts);
      acceptedVectors += vector.diagnostics.rangeDiagnostics.acceptedVectors;
      rejectedVectors += vector.diagnostics.rangeDiagnostics.rejectedVectors;
    }

    assert(acceptedVectors === ACCEPTED_TARGET, `acceptedVectors mismatch for ${scenario}: ${acceptedVectors}`);
    assert(totalAttempts === acceptedVectors + rejectedVectors, `vector accounting mismatch for ${scenario}: totalAttempts=${totalAttempts}, accepted=${acceptedVectors}, rejected=${rejectedVectors}`);

    const allForScenario = __debugAllAttemptTrace.filter((row) => row.scenario === scenario);
    const acceptedCount = allForScenario.filter((row) => row.vectorAccepted).length;
    const rejectedCount = allForScenario.filter((row) => !row.vectorAccepted).length;
    assert(allForScenario.length === acceptedCount + rejectedCount, `all vs accepted+rejected mismatch for ${scenario}`);
    assert(acceptedCount / order.length === ACCEPTED_TARGET, `accepted count per ETF mismatch for ${scenario}: ${acceptedCount / order.length}`);

    table1.push({
      scenario,
      totalAttempts,
      acceptedVectors,
      rejectedVectors,
      rejectRate: rejectedVectors / totalAttempts,
      meanAttemptsPerAccepted: totalAttempts / acceptedVectors,
    });

    for (const isin of order) {
      const byEtf = allForScenario.filter((row) => row.isin === isin);
      const accepted = byEtf.filter((row) => row.vectorAccepted);
      const rejected = byEtf.filter((row) => !row.vectorAccepted);

      const acceptedMonthlyReturns = accepted.map((row) => row.monthlyReturn);
      const allShock = byEtf.map((row) => row.standardizedShock);
      const acceptedShock = accepted.map((row) => row.standardizedShock);
      const rejectedShock = rejected.map((row) => row.standardizedShock);

      const stdAllShock = sampleStdDev(allShock);
      const stdAcceptedShock = sampleStdDev(acceptedShock);
      const stdRejectedShock = sampleStdDev(rejectedShock);
      const compressionRatio = stdAllShock > 0 ? stdAcceptedShock / stdAllShock : 0;

      const runtimeRecord = accepted[0];
      assert(runtimeRecord !== undefined, `missing accepted runtime record for ${scenario}/${isin}`);
      const sigmaEff = runtimeRecord.sigmaEff;
      const muEff = runtimeRecord.muEff;
      const annualSigmaEff = sigmaEff * Math.sqrt(12);
      const annualAcceptedReturnVol = sampleStdDev(acceptedMonthlyReturns) * Math.sqrt(12);
      const expectedAcceptedReturnVol = sigmaEff * stdAcceptedShock * Math.sqrt(12);
      const zLower = (runtimeRecord.effectiveMin - muEff) / sigmaEff;
      const zUpper = (runtimeRecord.effectiveMax - muEff) / sigmaEff;

      table2.push({
        scenario,
        ETF: isin,
        annualSigmaEff,
        zLower,
        zUpper,
        stdAllShock,
        stdAcceptedShock,
        stdRejectedShock,
        compressionRatio,
        annualAcceptedReturnVol,
        expectedAcceptedReturnVol,
      });
    }
  }

  console.log('TABLE1');
  console.log(JSON.stringify(table1, null, 2));
  console.log('TABLE2');
  console.log(JSON.stringify(table2, null, 2));

  await sequelize.close();
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
