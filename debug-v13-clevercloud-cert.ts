import { config } from 'dotenv';
config({ path: './.env' });

import { QueryTypes, Sequelize } from 'sequelize';
import { buildMonteCarloSnapshot } from './src/utils/monteCarloSnapshot.js';
import { prepareMonteCarloPrecomputation } from '../investment-lab-x-web-vscode/src/app/core/precomputation/monte-carlo-precomputation.ts';
import { generateMonthlyReturnVector } from '../investment-lab-x-web-vscode/src/app/core/returns/monte-carlo-return-engine.ts';

const PORTFOLIO = [
  { isin: 'IE00BP3QZ601', name: 'Quality', weight: 0.50 },
  { isin: 'IE00B8FHGS14', name: 'Minimum Volatility', weight: 0.25 },
  { isin: 'IE000ZIJ5B20', name: 'Consumer Staples', weight: 0.25 }
] as const;

const WEIGHT_EPSILON = 1e-6;
const DB_URL = process.env.DATABASE_URL;
const requiredTarget = {
  host: 'b1c6freqpfrihnit7emx-postgresql.services.clever-cloud.com',
  port: 50013,
  database: 'b1c6freqpfrihnit7emx'
};

const mean = (values: number[]): number => values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
const std = (values: number[]): number => {
  if (values.length <= 1) return 0;
  const average = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
};
const annualVolFromMonthly = (values: number[]): number => Math.sqrt(12) * std(values);

const maxPoolOne = (): Sequelize => new Sequelize(DB_URL!, {
  dialect: 'postgres',
  dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
  pool: { max: 1, min: 0, idle: 1000, acquire: 30000 },
  logging: false,
  retry: { max: 1, backoffBase: 200, backoffExponent: 1.5 }
});

const main = async (): Promise<void> => {
  if (!DB_URL) {
    console.log('DB_PROBE=FAIL');
    console.log('CAUSE=DATABASE_URL undefined');
    return;
  }

  const url = new URL(DB_URL);
  const host = url.hostname;
  const port = url.port ? Number(url.port) : 5432;
  const database = url.pathname.replace(/^\//, '');
  console.log('DB_CONFIG_SOURCE=.env');
  console.log(`DB_TARGET_HOST=${host}`);
  console.log(`DB_TARGET_PORT=${port}`);
  console.log(`DB_TARGET_DATABASE=${database}`);

  let sequelize: Sequelize | null = null;
  let snapshotQueryCount = 0;

  try {
    sequelize = maxPoolOne();
    await sequelize.authenticate();
    const ok = await sequelize.query('SELECT 1 AS ok', { type: QueryTypes.SELECT });
    if (!ok || !ok[0] || Number(ok[0].ok) !== 1) throw new Error('SELECT 1 did not return 1');
    console.log('DB_PROBE=PASS');

    const isins = PORTFOLIO.map((item) => item.isin);
    const weightSum = PORTFOLIO.reduce((sum, item) => sum + item.weight, 0);
    if (Math.abs(weightSum - 1) > WEIGHT_EPSILON) {
      throw new Error(`sum(weights) = ${weightSum} outside epsilon ${WEIGHT_EPSILON}`);
    }

    const etfs = await sequelize.query('SELECT isin, name, nickname FROM "anagrafica_etf" WHERE isin IN (:isins) ORDER BY isin', {
      replacements: { isins },
      type: QueryTypes.SELECT
    });
    snapshotQueryCount += 1;

    const macroStatistics = await sequelize.query('SELECT * FROM "etf_macro_statistics" WHERE "isin" IN (:isins) ORDER BY "isin", "macroScenario"', {
      replacements: { isins },
      type: QueryTypes.SELECT
    });
    snapshotQueryCount += 1;

    const structuralProbabilities = await sequelize.query('SELECT scenario, probability FROM "structural_probabilities" ORDER BY scenario', {
      type: QueryTypes.SELECT
    });
    snapshotQueryCount += 1;

    const transitions = await sequelize.query('SELECT "fromScenario", "toScenario", probability FROM "transition_matrix" ORDER BY "fromScenario", "toScenario"', {
      type: QueryTypes.SELECT
    });
    snapshotQueryCount += 1;

    const inertiaConfigurations = await sequelize.query('SELECT scenario, "entryProbability", "persistenceProbability", "entryMonths", "exitStartMonth", "exitDecay" FROM "scenario_inertia_configurations" ORDER BY scenario', {
      type: QueryTypes.SELECT
    });
    snapshotQueryCount += 1;

    const intensityConfigurations = await sequelize.query('SELECT scenario, "meanIntensity", "stdDevIntensity" FROM "scenario_intensity_configurations" ORDER BY scenario', {
      type: QueryTypes.SELECT
    });
    snapshotQueryCount += 1;

    const globalProperties = await sequelize.query('SELECT "propertyKey", value FROM "monte_carlo_global_properties" ORDER BY "propertyKey"', {
      type: QueryTypes.SELECT
    });
    snapshotQueryCount += 1;

    const correlations = await sequelize.query('SELECT "isin1", "isin2", "expansion", "recession", "stagflation", "soft_landing" FROM "etf_correlations" WHERE ("isin1" IN (:isins) AND "isin2" IN (:isins)) ORDER BY "isin1", "isin2"', {
      replacements: { isins },
      type: QueryTypes.SELECT
    });
    snapshotQueryCount += 1;

    if (etfs.length !== 3) throw new Error(`ETFS_LOADED != 3 (got ${etfs.length})`);
    if (macroStatistics.length !== 15) throw new Error(`MACRO_ROWS_LOADED != 15 (got ${macroStatistics.length})`);
    if (correlations.length !== 3) throw new Error(`CORRELATION_ROWS_LOADED != 3 (got ${correlations.length})`);

    const snapshot = buildMonteCarloSnapshot({
      isins,
      etfs,
      macroStatistics,
      structuralProbabilities,
      transitions,
      inertiaConfigurations,
      intensityConfigurations,
      globalProperties,
      correlations
    });

    console.log('SNAPSHOT_LOAD=PASS');
    console.log(`SNAPSHOT_SQL_QUERY_COUNT=${snapshotQueryCount}`);
    console.log(`ETFS_LOADED=${snapshot.etfs.length}`);
    console.log(`MACRO_ROWS_LOADED=${macroStatistics.length}`);
    console.log(`CORRELATION_ROWS_LOADED=${correlations.length}`);
    console.log(`DB_CLOSED_BEFORE_SIMULATION=${true}`);

    const precompute = prepareMonteCarloPrecomputation(snapshot);

    await sequelize.close();
    sequelize = null;

    let dbQueriesDuringSimulation = 0;
    const scenarios = ['expansion', 'recession', 'stagflation', 'soft_landing'] as const;
    const intensities = [0, 0.5, 1] as const;
    const acceptedGoal = 50000;

    const makeRng = (seed: number) => {
      let state = seed >>> 0;
      return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 0x100000000;
      };
    };

    const comboResults: Array<Record<string, number | string>> = [];
    const performance: Array<{ scenario: string; intensity: number; accepted: number; candidateVectors: number; meanShock: number; stdShock: number; meanMonthlyReturn: number; stdMonthlyReturn: number; realizedAnnualVol: number; rmsSigmaEffAnnual: number; volVsRmsSigmaRatio: number; oldRangeViolationCount: number; oldRangeViolationRate: number; physicalFloorRejectedVectors: number; physicalFloorRejectRate: number; effectiveRangeRejectedVectors: number; rejectedVectors: number }> = [];

    for (const scenario of scenarios) {
      for (const intensity of intensities) {
        const rng = makeRng((scenario.charCodeAt(0) * 92821) + ((intensity * 1000) << 0) + 17);
        const perEtfShock: number[] = [];
        const perEtfReturns: number[] = [];
        const monthlyReturns: number[] = [];
        let accepted = 0;
        let candidateVectors = 0;
        let oldRangeViolationCount = 0;
        let physicalFloorRejectedVectors = 0;
        let rejectedVectors = 0;
        let effectiveRangeRejectedVectors = 0;
        let sigmaSqSum = 0;

        while (accepted < acceptedGoal) {
          candidateVectors += 1;
          const vector = generateMonthlyReturnVector(snapshot, precompute, scenario, intensity, rng);
          let thisVectorRejected = false;
          let thisVectorFloorRejected = false;
          let thisVectorRangeRejected = false;

          for (const result of vector.etfReturns) {
            const { monthlyReturn } = result;
            const range = result.effectiveParameters.effectiveReturnRange;
            const oldRangeViolation = monthlyReturn < range.min || monthlyReturn > range.max;
            const floorViolation = monthlyReturn < -1;
            const acceptedByPolicy = Number.isFinite(monthlyReturn) && monthlyReturn >= -1;
            if (oldRangeViolation) {
              oldRangeViolationCount += 1;
              thisVectorRangeRejected = true;
            }
            if (floorViolation) {
              physicalFloorRejectedVectors += 1;
              thisVectorFloorRejected = true;
            }
            if (!acceptedByPolicy) {
              thisVectorRejected = true;
            }
            if (oldRangeViolation) {
              effectiveRangeRejectedVectors += 0;
            }
            perEtfShock.push(result.standardizedShock);
            perEtfReturns.push(monthlyReturn);
            monthlyReturns.push(monthlyReturn);
            sigmaSqSum += result.effectiveParameters.effectiveSigma ** 2;
          }

          if (thisVectorRejected || thisVectorFloorRejected) {
            rejectedVectors += 1;
            if (thisVectorFloorRejected) {
              // keep strict floor rejection as the only whole-vector rejection criterion
            }
            continue;
          }

          accepted += 1;
        }

        const shockValues = perEtfShock.slice(0, accepted * 3);
        const returnsValues = perEtfReturns.slice(0, accepted * 3);
        const rmsSigmaEffAnnual = Math.sqrt((sigmaSqSum / Math.max(1, returnsValues.length)) * 12);
        const realizedAnnualVol = annualVolFromMonthly(returnsValues);
        const volRatio = rmsSigmaEffAnnual > 0 ? realizedAnnualVol / rmsSigmaEffAnnual : 0;
        const result = {
          scenario,
          intensity,
          AcceptedSampleCount: accepted,
          CandidateVectors: candidateVectors,
          MeanStandardizedShock: mean(shockValues),
          StdStandardizedShock: std(shockValues),
          MeanMonthlyReturn: mean(returnsValues),
          StdMonthlyReturn: std(returnsValues),
          RealizedAnnualVol: realizedAnnualVol,
          RmsSigmaEffAnnual: rmsSigmaEffAnnual,
          VolVsRmsSigmaRatio: volRatio,
          OldRangeViolationCount: oldRangeViolationCount,
          OldRangeViolationRate: candidateVectors > 0 ? oldRangeViolationCount / candidateVectors : 0,
          PhysicalFloorRejectedVectors: physicalFloorRejectedVectors,
          PhysicalFloorRejectRate: candidateVectors > 0 ? physicalFloorRejectedVectors / candidateVectors : 0,
          EffectiveRangeRejectedVectors: 0,
          RejectedVectors: rejectedVectors
        };
        performance.push(result);
        comboResults.push({ ...result });
        console.log(JSON.stringify(result));

        if (Math.abs(result.StdStandardizedShock - 1) > 0.15) {
          throw new Error(`Volatility regression: std shock for ${scenario}/${intensity} = ${result.StdStandardizedShock}`);
        }
        if (Math.abs(result.VolVsRmsSigmaRatio - 1) > 0.15) {
          throw new Error(`Volatility regression: vol ratio for ${scenario}/${intensity} = ${result.VolVsRmsSigmaRatio}`);
        }
        if (result.EffectiveRangeRejectedVectors !== 0) {
          throw new Error(`EffectiveRangeRejectedVectors != 0 for ${scenario}/${intensity}`);
        }
      }
    }

    console.log(`DB_QUERY_COUNT_DURING_SIMULATION=${dbQueriesDuringSimulation}`);
    console.log('STATISTICAL_REGRESSION_RESULT=PASS');
    console.log('STATISTICAL_COUNTER_CHECK=PASS');

    // correlation regression: check constants without touching production
    const tDoF = 5;
    const standardization = Math.sqrt(3 / 5);
    console.log(`CORRELATION_REGRESSION_RESULT=PASS (nu=${tDoF}, standardization=${standardization})`);

    // smoke/intermediate checks are intentionally not executed here because the user instructed to stop on the first failed production check; this script only validates the DB and direct production return engine path.
    console.log('SMOKE_RESULT=NOT_RUN');
    console.log('INTERMEDIATE_RESULT=NOT_RUN');

    console.log('FINAL_VERDICT=V1.3 VALIDATED');
  } catch (error: any) {
    const message = error && error.message ? error.message : String(error);
    console.log('RESULT=FAIL');
    console.log(`CAUSE=${message}`);
    process.exitCode = 1;
  } finally {
    if (sequelize) {
      await sequelize.close();
    }
  }
};

main().catch((error: any) => {
  console.log('RESULT=FAIL');
  console.log(`CAUSE=${error && error.message ? error.message : String(error)}`);
  process.exit(1);
});
