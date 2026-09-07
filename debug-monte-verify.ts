import { config } from 'dotenv';
config();

import { Sequelize, QueryTypes } from 'sequelize';
import { buildMonteCarloSnapshot } from './src/utils/monteCarloSnapshot.js';
import { prepareMonteCarloPrecomputation } from '../investment-lab-x-web-vscode/src/app/core/precomputation/monte-carlo-precomputation.ts';
import { generateMonthlyMacroTimeline } from '../investment-lab-x-web-vscode/src/app/core/macro/monte-carlo-macro-engine.ts';
import { generateMonthlyReturnVector } from '../investment-lab-x-web-vscode/src/app/core/returns/monte-carlo-return-engine.ts';
import { SeededRandom } from '../investment-lab-x-web-vscode/src/app/core/engines/seeded-random.ts';

const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
  logging: false,
});

async function run() {
  await sequelize.authenticate();

  const portfolioRow = await sequelize.query(
    `SELECT id, nome FROM "portafogli" WHERE LOWER(CAST("nome" AS TEXT)) = LOWER('Ricerca azionario') LIMIT 1`,
    { type: QueryTypes.SELECT }
  );

  if (!portfolioRow[0]) throw new Error('Portfolio not found');

  const holdings = await sequelize.query(
    `SELECT pe."peso" AS weight_pct, e.isin, e.name, e.ticker
     FROM "portafoglio_etf" pe
     JOIN "anagrafica_etf" e ON e.id = pe."etfId"
     WHERE pe."portafoglioId" = :pid ORDER BY CAST(pe."peso" AS numeric) DESC`,
    { replacements: { pid: portfolioRow[0].id }, type: QueryTypes.SELECT }
  );

  const raw = holdings.map((h: any) => ({ isin: h.isin, weight: Number(h.weight_pct) / 100 }));
  const total = raw.reduce((sum, p) => sum + p.weight, 0);
  const positions = raw.map((p) => ({ ...p, weight: p.weight / total }));
  const isins = [...new Set(positions.map((p) => p.isin))];

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

  const snapshot = buildMonteCarloSnapshot({
    isins,
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
  const sigmaByIsin = new Map<string, number[]>();
  positions.forEach((p) => sigmaByIsin.set(p.isin, []));

  const pathStats: Array<{ realizedAnnualVol: number; theoreticalAnnualVol: number; ratio: number; diffPctPoints: number }> = [];
  const pathCount = 100;

  for (let sim = 0; sim < pathCount; sim += 1) {
    const rng = new SeededRandom((sim + 1) * 9973 + 17);
    const macro = generateMonthlyMacroTimeline(snapshot, 120, () => rng.next());
    const vectors = macro.months.map((monthState) =>
      generateMonthlyReturnVector(snapshot, precompute, monthState.scenario, monthState.intensity, () => rng.next())
    );

    const portfolioMonthlyReturns: number[] = [];
    const theoreticalSigmas: number[] = [];

    for (let m = 0; m < vectors.length; m += 1) {
      const vector = vectors[m];
      const sigma = vector.etfReturns.map((r) => r.effectiveParameters.effectiveSigma);
      const matrix = precompute.correlationMatrices[macro.months[m].scenario].operationalMatrix;
      let variance = 0;
      for (let i = 0; i < positions.length; i += 1) {
        for (let j = 0; j < positions.length; j += 1) {
          variance += positions[i].weight * sigma[i] * matrix[i][j] * sigma[j] * positions[j].weight;
        }
      }
      const theoreticalSigma = Math.sqrt(Math.max(0, variance));
      theoreticalSigmas.push(theoreticalSigma);

      const monthReturn = positions.reduce((sum, position) => {
        const row = vector.etfReturns.find((r) => r.isin === position.isin);
        return sum + position.weight * (row ? row.monthlyReturn : 0);
      }, 0);
      portfolioMonthlyReturns.push(monthReturn);

      positions.forEach((position) => {
        const row = vector.etfReturns.find((r) => r.isin === position.isin);
        if (row) sigmaByIsin.get(position.isin)!.push(row.effectiveParameters.effectiveSigma);
      });
    }

    const meanMonthlyReturn = portfolioMonthlyReturns.reduce((sum, value) => sum + value, 0) / portfolioMonthlyReturns.length;
    const sampleStd = Math.sqrt(
      portfolioMonthlyReturns.reduce((sum, value) => sum + (value - meanMonthlyReturn) ** 2, 0) /
        (portfolioMonthlyReturns.length - 1)
    );
    const realizedAnnualVol = sampleStd * Math.sqrt(12);
    const theoreticalMonthlyVol = Math.sqrt(theoreticalSigmas.reduce((sum, value) => sum + value * value, 0) / theoreticalSigmas.length);
    const theoreticalAnnualVol = theoreticalMonthlyVol * Math.sqrt(12);

    pathStats.push({
      realizedAnnualVol,
      theoreticalAnnualVol,
      ratio: realizedAnnualVol / theoreticalAnnualVol,
      diffPctPoints: (realizedAnnualVol - theoreticalAnnualVol) * 100,
    });
  }

  const etfSummary = positions.map((position) => {
    const values = sigmaByIsin.get(position.isin)!;
    const meanMonthly = values.reduce((sum, value) => sum + value, 0) / values.length;
    const rmsMonthly = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
    return {
      isin: position.isin,
      weight: position.weight,
      meanSigmaEffMonthly: meanMonthly,
      meanSigmaEffAnnual: meanMonthly * Math.sqrt(12),
      rmsSigmaEffMonthly: rmsMonthly,
      rmsSigmaEffAnnual: rmsMonthly * Math.sqrt(12),
    };
  });

  const meanPath = {
    realizedAnnualVol: pathStats.reduce((sum, value) => sum + value.realizedAnnualVol, 0) / pathStats.length,
    theoreticalAnnualVol: pathStats.reduce((sum, value) => sum + value.theoreticalAnnualVol, 0) / pathStats.length,
    ratio: pathStats.reduce((sum, value) => sum + value.ratio, 0) / pathStats.length,
    diffPctPoints: pathStats.reduce((sum, value) => sum + value.diffPctPoints, 0) / pathStats.length,
  };

  console.log(JSON.stringify({
    portfolio: positions,
    etfSummary,
    meanPath,
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
}).finally(async () => {
  await sequelize.close();
});
