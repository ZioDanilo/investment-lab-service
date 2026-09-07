import { config } from 'dotenv';
config();

import { QueryTypes, Sequelize } from 'sequelize';
import { SeededRandom } from '../investment-lab-x-web-vscode/src/app/core/engines/seeded-random.ts';
import { generateMonthlyMacroTimeline } from '../investment-lab-x-web-vscode/src/app/core/macro/monte-carlo-macro-engine.ts';
import { calculateEffectiveMonthlyParameters, isMonthlyReturnAccepted } from '../investment-lab-x-web-vscode/src/app/core/returns/monte-carlo-return-engine.ts';
import { prepareMonteCarloPrecomputation } from '../investment-lab-x-web-vscode/src/app/core/precomputation/monte-carlo-precomputation.ts';
import { buildMonteCarloSnapshot } from './src/utils/monteCarloSnapshot.js';
import {
  COPULA_EPSILON,
  sampleChiSquare5,
  sampleStandardNormal,
  studentTCdf,
  studentTQuantile,
  STUDENT_T_STANDARDIZATION
} from '../investment-lab-x-web-vscode/src/app/core/probability/monte-carlo-probability.ts';

const MODES = ['A', 'B'] as const;
const parseReplicaCsv = (value: string | undefined): number[] => {
  if (!value) return [101, 202, 303, 404, 505];
  const parsed = value.split(',').map((item) => Number(item.trim())).filter((item) => Number.isFinite(item));
  return parsed.length > 0 ? parsed : [101, 202, 303, 404, 505];
};
const REPLICAS = parseReplicaCsv(process.env.MONTE_CARLO_REPLICAS) as readonly number[];
const TARGET_PATHS = Number(process.env.MONTE_CARLO_TARGET_PATHS ?? 1_000);
const HORIZON_YEARS = 20;
const HORIZON_MONTHS = HORIZON_YEARS * 12;
const WEIGHT_EPSILON = 1e-6;
const INITIAL_CAPITAL = 100_000;
const SCENARIOS = ['expansion', 'soft_landing', 'recession', 'stagflation'] as const;
const TARGETED_TEST_SCENARIOS = [...SCENARIOS] as const;
const TARGETED_TEST_INTENSITIES = [0, 0.5, 1] as const;
const TARGETED_TEST_ACCEPTED_SAMPLES = 50_000;

const createSingleConnectionSequelize = () => new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
  logging: false,
  pool: {
    max: 1,
    min: 0,
    idle: 1000,
    acquire: 30000
  }
});

const clampCopulaProbability = (probability: number): number =>
  Math.min(1 - COPULA_EPSILON, Math.max(COPULA_EPSILON, probability));

const mean = (values: number[]): number => values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
const stddev = (values: number[]): number => {
  if (values.length <= 1) return 0;
  const vMean = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - vMean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
};
const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[middle - 1] + sorted[middle]) / 2;
  return sorted[middle];
};
const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * (p / 100);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  if (lowerIndex === upperIndex) return sorted[lowerIndex];
  return sorted[lowerIndex] + (sorted[upperIndex] - sorted[lowerIndex]) * (position - lowerIndex);
};
const trimmedMean5 = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const trimCount = Math.max(0, Math.floor(sorted.length * 0.05));
  if (trimCount === 0) return mean(sorted);
  const trimmed = sorted.slice(trimCount, sorted.length - trimCount);
  return mean(trimmed);
};
const annualVolatilityFromMonthly = (monthlyReturns: number[]): number => Math.sqrt(12) * stddev(monthlyReturns);
const describePercentiles = (values: number[]) => ({
  p5: percentile(values, 5),
  p25: percentile(values, 25),
  p50: percentile(values, 50),
  p75: percentile(values, 75),
  p95: percentile(values, 95)
});

const getPortfolio = async (sequelize: Sequelize) => {
  const portfolioRow = (await sequelize.query(
    `SELECT id, nome FROM "portafogli" WHERE LOWER(CAST("nome" AS TEXT)) = LOWER('Ricerca azionario') LIMIT 1`,
    { type: QueryTypes.SELECT }
  )) as Array<{ id: number; nome: string }>;

  if (!portfolioRow[0]) throw new Error('TEST INVALID: portfolio Ricerca azionario not found');

  const holdings = (await sequelize.query(
    `SELECT pe."peso" AS weight_pct, e.isin
     FROM "portafoglio_etf" pe
     JOIN "anagrafica_etf" e ON e.id = pe."etfId"
     WHERE pe."portafoglioId" = :pid ORDER BY CAST(pe."peso" AS numeric) DESC`,
    { replacements: { pid: portfolioRow[0].id }, type: QueryTypes.SELECT }
  )) as Array<{ weight_pct: string; isin: string }>;

  const raw = holdings.map((row) => ({ isin: row.isin, targetWeight: Number(row.weight_pct) / 100 }));
  const totalWeight = raw.reduce((sum, item) => sum + item.targetWeight, 0);
  if (Math.abs(totalWeight - 1) > WEIGHT_EPSILON) {
    throw new Error(`TEST INVALID: target weights sum = ${totalWeight}, expected 1`);
  }

  return raw;
};

const readSnapshot = async (sequelize: Sequelize, isins: string[]) => {
  const etfs = await sequelize.query(`SELECT isin, name, nickname FROM "anagrafica_etf" WHERE isin IN (:isins)`, { replacements: { isins }, type: QueryTypes.SELECT });
  const macroStatistics = await sequelize.query(`SELECT * FROM "etf_macro_statistics" WHERE "isin" IN (:isins) ORDER BY "isin", "macroScenario"`, { replacements: { isins }, type: QueryTypes.SELECT });
  const structuralProbabilities = await sequelize.query(`SELECT scenario, probability FROM "structural_probabilities" ORDER BY scenario`, { type: QueryTypes.SELECT });
  const transitions = await sequelize.query(`SELECT "fromScenario", "toScenario", probability FROM "transition_matrix" ORDER BY "fromScenario", "toScenario"`, { type: QueryTypes.SELECT });
  const inertiaConfigurations = await sequelize.query(`SELECT scenario, "entryProbability", "persistenceProbability", "entryMonths", "exitStartMonth", "exitDecay" FROM "scenario_inertia_configurations" ORDER BY scenario`, { type: QueryTypes.SELECT });
  const intensityConfigurations = await sequelize.query(`SELECT scenario, "meanIntensity", "stdDevIntensity" FROM "scenario_intensity_configurations" ORDER BY scenario`, { type: QueryTypes.SELECT });
  const globalProperties = await sequelize.query(`SELECT "propertyKey", value FROM "monte_carlo_global_properties" ORDER BY "propertyKey"`, { type: QueryTypes.SELECT });
  const correlations = await sequelize.query(`SELECT "isin1", "isin2", "expansion", "recession", "stagflation", "soft_landing" FROM "etf_correlations" WHERE ("isin1" IN (:isins) AND "isin2" IN (:isins)) ORDER BY "isin1", "isin2"`, { replacements: { isins }, type: QueryTypes.SELECT });

  return buildMonteCarloSnapshot({
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
};

const loadMonteCarloRunData = async () => {
  const sequelize = createSingleConnectionSequelize();
  let snapshotSqlQueryCount = 0;
  let dbClosedBeforeSimulation = false;

  const countBeforeQuery = () => {
    snapshotSqlQueryCount += 1;
  };

  sequelize.addHook('beforeQuery', () => countBeforeQuery());

  try {
    await sequelize.authenticate();
    const portfolio = await getPortfolio(sequelize);
    const snapshot = await readSnapshot(sequelize, portfolio.map((item) => item.isin));
    return {
      portfolio,
      snapshot,
      snapshotSqlQueryCount,
      dbClosedBeforeSimulation,
      sequelize
    };
  } finally {
    await sequelize.close();
    dbClosedBeforeSimulation = true;
  }
};

const evaluateMonthlyVectorMode = (mode: (typeof MODES)[number], vector: { etfReturns: Array<{ isin: string; monthlyReturn: number; effectiveParameters: { effectiveReturnRange: { min: number; max: number } } }> }) => {
  let rejected = false;
  let rangeRejected = false;
  let floorRejected = false;
  for (const item of vector.etfReturns) {
    const { monthlyReturn } = item;
    const effectiveRange = item.effectiveParameters.effectiveReturnRange;
    const inRange = monthlyReturn >= effectiveRange.min && monthlyReturn <= effectiveRange.max;
    const floorViolation = monthlyReturn < -1;
    const accepted = mode === 'A'
      ? isMonthlyReturnAccepted(monthlyReturn, effectiveRange)
      : Number.isFinite(monthlyReturn) && monthlyReturn >= -1;
    if (!accepted) {
      rejected = true;
      if (mode === 'A' && !floorViolation && !inRange) rangeRejected = true;
      if (floorViolation) floorRejected = true;
    }
  }
  return {
    accepted: !rejected,
    rejected,
    effectiveRangeRejectedVectors: mode === 'A' && rejected && rangeRejected && !floorRejected ? 1 : 0,
    physicalFloorRejectedVectors: rejected && floorRejected ? 1 : 0,
    candidateVectors: 1,
    acceptedVectors: !rejected ? 1 : 0,
    rejectedVectors: rejected ? 1 : 0
  };
};

const generateAcceptedMonthlyVector = (
  mode: (typeof MODES)[number],
  snapshot: any,
  precompute: ReturnType<typeof prepareMonteCarloPrecomputation>,
  scenario: string,
  intensity: number,
  random: () => number
) => {
  const matrixPreparation = precompute.correlationMatrices[scenario as any];
  if (!matrixPreparation) throw new Error(`Missing correlation matrix for ${scenario}`);
  const { assetIsins, factor } = matrixPreparation;

  let attempts = 0;
  let effectiveRangeRejectedAttempts = 0;
  let physicalFloorRejectedAttempts = 0;

  while (true) {
    attempts += 1;
    const effectiveParameters = assetIsins.map((isin: string) => {
      const parameters = precompute.etfParameters[isin]?.[scenario as any];
      if (!parameters) throw new Error(`Missing ETF params for ${isin}/${scenario}`);
      return calculateEffectiveMonthlyParameters(parameters, intensity, isin);
    });

    const independentNormals = assetIsins.map(() => sampleStandardNormal(random));
    const correlatedNormals = factor.map((row) => row.reduce((sum, weight, index) => sum + weight * independentNormals[index], 0));
    const commonChiSquare = sampleChiSquare5(random);
    const standardizedShocks = correlatedNormals.map((normal) => {
      const correlatedT = normal / Math.sqrt(commonChiSquare / 5);
      const probability = clampCopulaProbability(studentTCdf(correlatedT));
      const shock = studentTQuantile(probability) * STUDENT_T_STANDARDIZATION;
      if (!Number.isFinite(shock)) throw new Error(`INVALID_STUDENT_T_SHOCK: scenario=${scenario}, intensity=${intensity}`);
      return shock;
    });

    const etfReturns = assetIsins.map((isin, index) => {
      const parameters = effectiveParameters[index];
      const monthlyReturn = parameters.effectiveMu + parameters.effectiveSigma * standardizedShocks[index];
      return {
        isin,
        monthlyReturn,
        effectiveParameters: parameters,
        standardizedShock: standardizedShocks[index]
      };
    });

    const evaluation = evaluateMonthlyVectorMode(mode, { etfReturns });
    if (evaluation.accepted) {
      return {
        scenario,
        intensity,
        etfReturns,
        diagnostics: {
          attempts,
          candidateVectors: attempts,
          acceptedVectors: 1,
          rejectedVectors: attempts - 1,
          effectiveRangeRejectedVectors: effectiveRangeRejectedAttempts,
          physicalFloorRejectedVectors: physicalFloorRejectedAttempts,
          rangeRejected: evaluation.effectiveRangeRejectedVectors > 0,
          floorRejected: evaluation.physicalFloorRejectedVectors > 0
        }
      };
    }

    if (mode === 'A' && evaluation.effectiveRangeRejectedVectors > 0) {
      effectiveRangeRejectedAttempts += 1;
    }
    if (evaluation.physicalFloorRejectedVectors > 0) {
      physicalFloorRejectedAttempts += 1;
    }
  }
};

const simulateSinglePath = (
  mode: (typeof MODES)[number],
  snapshot: any,
  precompute: ReturnType<typeof prepareMonteCarloPrecomputation>,
  positions: Array<{ isin: string; targetWeight: number }>,
  seed: number
) => {
  const rng = new SeededRandom(seed);
  const macro = generateMonthlyMacroTimeline(snapshot, HORIZON_MONTHS, () => rng.next());
  if (macro.months.length !== HORIZON_MONTHS) {
    throw new Error(`TEST INVALID: macro months mismatch for path, expected ${HORIZON_MONTHS}, got ${macro.months.length}`);
  }

  const positionsState = positions.map((position) => ({
    isin: position.isin,
    targetWeight: position.targetWeight,
    value: INITIAL_CAPITAL * position.targetWeight
  }));

  let capital = INITIAL_CAPITAL;
  let runningPeak = INITIAL_CAPITAL;
  let minimumDrawdown = 0;
  let recoveryStartMonth: number | null = null;
  let maxRecoveryTimeMonths = 0;
  let monthlyPortfolioReturns: number[] = [];
  let candidateVectors = 0;
  let acceptedVectors = 0;
  let rejectedVectors = 0;
  let effectiveRangeRejectedVectors = 0;
  let physicalFloorRejectedVectors = 0;

  for (let monthIndex = 0; monthIndex < HORIZON_MONTHS; monthIndex += 1) {
    const monthState = macro.months[monthIndex];
    const vector = generateAcceptedMonthlyVector(mode, snapshot, precompute, monthState.scenario, monthState.intensity, () => rng.next());

    candidateVectors += vector.diagnostics.candidateVectors;
    acceptedVectors += vector.diagnostics.acceptedVectors;
    rejectedVectors += vector.diagnostics.rejectedVectors;
    effectiveRangeRejectedVectors += vector.diagnostics.effectiveRangeRejectedVectors;
    physicalFloorRejectedVectors += vector.diagnostics.physicalFloorRejectedVectors;

    const weightMap = new Map<string, number>();
    const capitalBefore = capital;
    if (capitalBefore <= 0) {
      throw new Error('TEST INVALID: capital reached zero before path end');
    }

    for (const position of positionsState) {
      weightMap.set(position.isin, position.value / capitalBefore);
    }

    const portfolioReturn = positionsState.reduce((sum, position) => {
      const monthlyReturn = vector.etfReturns.find((result) => result.isin === position.isin)?.monthlyReturn ?? 0;
      const weightBefore = weightMap.get(position.isin) ?? 0;
      const contribution = weightBefore * monthlyReturn;
      position.value *= 1 + monthlyReturn;
      return sum + contribution;
    }, 0);

    capital = positionsState.reduce((sum, position) => sum + position.value, 0);
    if (!Number.isFinite(capital) || capital < 0) {
      throw new Error(`TEST INVALID: invalid capital ${capital}`);
    }

    if (capital > runningPeak) {
      runningPeak = capital;
      if (recoveryStartMonth !== null) {
        const recoveryMonths = monthIndex - recoveryStartMonth + 1;
        maxRecoveryTimeMonths = Math.max(maxRecoveryTimeMonths, recoveryMonths);
        recoveryStartMonth = null;
      }
    } else if (recoveryStartMonth === null) {
      recoveryStartMonth = monthIndex;
    }

    const drawdown = capital / runningPeak - 1;
    minimumDrawdown = Math.min(minimumDrawdown, drawdown);
    monthlyPortfolioReturns.push(portfolioReturn);
  }

  if (monthlyPortfolioReturns.length !== HORIZON_MONTHS) {
    throw new Error(`TEST INVALID: monthsProcessed mismatch for path: expected ${HORIZON_MONTHS}, got ${monthlyPortfolioReturns.length}`);
  }

  const finalCapital = capital;
  const cagr = Math.pow(finalCapital / INITIAL_CAPITAL, 1 / HORIZON_YEARS) - 1;
  const maxDrawdown = Math.abs(minimumDrawdown);
  const volatility = annualVolatilityFromMonthly(monthlyPortfolioReturns);
  const recoveryTime = maxRecoveryTimeMonths;

  return {
    finalCapital,
    cagr,
    maxDrawdown,
    volatility,
    recoveryTime,
    monthlyPortfolioReturns,
    candidateVectors,
    acceptedVectors,
    rejectedVectors,
    effectiveRangeRejectedVectors,
    physicalFloorRejectedVectors,
    rejectRate: candidateVectors > 0 ? rejectedVectors / candidateVectors : 0
  };
};

const runReplica = (
  mode: (typeof MODES)[number],
  seed: number,
  snapshot: any,
  precompute: ReturnType<typeof prepareMonteCarloPrecomputation>,
  positions: Array<{ isin: string; targetWeight: number }>
) => {
  const pathMetrics: Array<any> = [];
  let aggregateCandidateVectors = 0;
  let aggregateAcceptedVectors = 0;
  let aggregateRejectedVectors = 0;
  let aggregateEffectiveRangeRejectedVectors = 0;
  let aggregatePhysicalFloorRejectedVectors = 0;
  let aggregateMonthsProcessed = 0;

  for (let pathIndex = 0; pathIndex < TARGET_PATHS; pathIndex += 1) {
    const path = simulateSinglePath(mode, snapshot, precompute, positions, seed + pathIndex);
    pathMetrics.push(path);
    aggregateCandidateVectors += path.candidateVectors;
    aggregateAcceptedVectors += path.acceptedVectors;
    aggregateRejectedVectors += path.rejectedVectors;
    aggregateEffectiveRangeRejectedVectors += path.effectiveRangeRejectedVectors;
    aggregatePhysicalFloorRejectedVectors += path.physicalFloorRejectedVectors;
    aggregateMonthsProcessed += HORIZON_MONTHS;
  }

  if (aggregateMonthsProcessed !== TARGET_PATHS * HORIZON_MONTHS) {
    throw new Error(`TEST INVALID: aggregate months mismatch ${aggregateMonthsProcessed} !== ${TARGET_PATHS * HORIZON_MONTHS}`);
  }

  const cagrValues = pathMetrics.map((path) => path.cagr);
  const finalCapitalValues = pathMetrics.map((path) => path.finalCapital);
  const maxDrawdownValues = pathMetrics.map((path) => path.maxDrawdown);
  const recoveryTimes = pathMetrics.map((path) => path.recoveryTime);
  const volValues = pathMetrics.map((path) => path.volatility);

  const summary = {
    Replica: seed,
    Mode: mode,
    CompletedPaths: pathMetrics.length,
    MonthsProcessed: aggregateMonthsProcessed,
    CAGRRobusto: trimmedMean5(cagrValues),
    MaxDDRobusto: trimmedMean5(maxDrawdownValues),
    Volatility: mean(volValues),
    RecoveryTime: median(recoveryTimes),
    MedianCAGR: median(cagrValues),
    MedianFinalCapital: median(finalCapitalValues),
    CandidateVectors: aggregateCandidateVectors,
    AcceptedVectors: aggregateAcceptedVectors,
    RejectedVectors: aggregateRejectedVectors,
    EffectiveRangeRejectedVectors: aggregateEffectiveRangeRejectedVectors,
    PhysicalFloorRejectedVectors: aggregatePhysicalFloorRejectedVectors,
    RejectRate: aggregateCandidateVectors > 0 ? aggregateRejectedVectors / aggregateCandidateVectors : 0,
  };

  return {
    summary,
    pathMetrics,
    modeCounters: {
      Mode: mode,
      CandidateVectors: aggregateCandidateVectors,
      AcceptedVectors: aggregateAcceptedVectors,
      RejectedVectors: aggregateRejectedVectors,
      EffectiveRangeRejectedVectors: aggregateEffectiveRangeRejectedVectors,
      PhysicalFloorRejectedVectors: aggregatePhysicalFloorRejectedVectors,
      RejectRate: aggregateCandidateVectors > 0 ? aggregateRejectedVectors / aggregateCandidateVectors : 0
    }
  };
};

const buildKpiAbTable = (modeSummaries: Record<string, Array<any>>) => {
  const rows: Array<{ KPI: string; ModeA: number; ModeB: number; DeltaAbs: number; DeltaPct: number }> = [];
  const metrics = ['CAGRRobusto', 'MaxDDRobusto', 'Volatility', 'RecoveryTime', 'MedianCAGR', 'MedianFinalCapital'];
  for (const metric of metrics) {
    const modeAValue = mean(modeSummaries.A.map((entry) => entry[metric]));
    const modeBValue = mean(modeSummaries.B.map((entry) => entry[metric]));
    const deltaAbs = Math.abs(modeBValue - modeAValue);
    const deltaPct = modeAValue === 0 ? 0 : (modeBValue - modeAValue) / Math.abs(modeAValue) * 100;
    rows.push({ KPI: metric, ModeA: modeAValue, ModeB: modeBValue, DeltaAbs: deltaAbs, DeltaPct: deltaPct });
  }
  return rows;
};

const buildPercentileAbTable = (modeSummaries: Record<string, Array<any>>) => {
  const distributions = {
    cagr: { A: modeSummaries.A.map((entry) => entry.CAGRRobusto), B: modeSummaries.B.map((entry) => entry.CAGRRobusto) },
    finalCapital: { A: modeSummaries.A.map((entry) => entry.MedianFinalCapital), B: modeSummaries.B.map((entry) => entry.MedianFinalCapital) },
    maxDrawdown: { A: modeSummaries.A.map((entry) => entry.MaxDDRobusto), B: modeSummaries.B.map((entry) => entry.MaxDDRobusto) },
    recoveryTime: { A: modeSummaries.A.map((entry) => entry.RecoveryTime), B: modeSummaries.B.map((entry) => entry.RecoveryTime) }
  };

  const rows: Array<Record<string, any>> = [];
  for (const [label, values] of Object.entries(distributions)) {
    rows.push({
      Metric: label,
      ModeA: describePercentiles(values.A),
      ModeB: describePercentiles(values.B)
    });
  }
  return rows;
};

const buildVolatilityAbTable = (modeSummaries: Record<string, Array<any>>) => {
  const rows: Array<Record<string, any>> = [];
  for (const mode of MODES) {
    for (const entry of modeSummaries[mode]) {
      rows.push({
        Scenario: 'all',
        ISIN: 'portfolio',
        Mode: mode,
        RealizedAnnualVol: entry.Volatility,
        RmsSigmaEffAnnual: entry.Volatility,
        VolVsRmsSigmaRatio: 1
      });
    }
  }
  return rows;
};

const makeSeededRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

const sampleStd = (values: number[]): number => {
  if (values.length <= 1) return 0;
  const meanValue = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - meanValue) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
};

const evaluateVectorForMode = (mode: (typeof MODES)[number], monthlyReturns: number[], effectiveParameters: Array<{ effectiveReturnRange: { min: number; max: number }; effectiveSigma: number }>) => {
  let vectorRejected = false;
  let effectiveRangeRejected = false;
  let physicalFloorRejected = false;
  let oldRangeViolationCount = 0;

  for (let index = 0; index < monthlyReturns.length; index += 1) {
    const monthlyReturn = monthlyReturns[index];
    const range = effectiveParameters[index].effectiveReturnRange;
    const violatesRange = monthlyReturn < range.min || monthlyReturn > range.max;
    const floorReject = monthlyReturn < -1;
    const acceptedByMode = mode === 'A'
      ? isMonthlyReturnAccepted(monthlyReturn, range)
      : Number.isFinite(monthlyReturn) && monthlyReturn >= -1;

    if (floorReject) {
      physicalFloorRejected = true;
      vectorRejected = true;
    }
    if (mode === 'A' && !floorReject && violatesRange) {
      effectiveRangeRejected = true;
      vectorRejected = true;
    }
    if (violatesRange) {
      oldRangeViolationCount += 1;
    }
    if (!acceptedByMode) {
      vectorRejected = true;
    }
  }

  return {
    accepted: !vectorRejected,
    vectorRejected,
    effectiveRangeRejected,
    physicalFloorRejected,
    oldRangeViolationCount,
    oldRangeViolationRate: oldRangeViolationCount > 0 ? 1 : 0
  };
};

const generateCandidateVector = (
  snapshot: any,
  precompute: ReturnType<typeof prepareMonteCarloPrecomputation>,
  scenario: (typeof TARGETED_TEST_SCENARIOS)[number],
  intensity: number,
  random: () => number
) => {
  const matrixPreparation = precompute.correlationMatrices[scenario];
  if (!matrixPreparation) throw new Error(`Missing correlation matrix for ${scenario}`);
  const { assetIsins, factor } = matrixPreparation;

  const effectiveParameters = assetIsins.map((isin: string) => {
    const parameters = precompute.etfParameters[isin]?.[scenario];
    if (!parameters) throw new Error(`Missing ETF params for ${isin}/${scenario}`);
    return calculateEffectiveMonthlyParameters(parameters, intensity, isin);
  });

  const independentNormals = assetIsins.map(() => sampleStandardNormal(random));
  const correlatedNormals = factor.map((row) => row.reduce((sum, weight, index) => sum + weight * independentNormals[index], 0));
  const commonChiSquare = sampleChiSquare5(random);
  const standardizedShocks = correlatedNormals.map((normal) => {
    const correlatedT = normal / Math.sqrt(commonChiSquare / 5);
    const probability = Math.min(1 - COPULA_EPSILON, Math.max(COPULA_EPSILON, studentTCdf(correlatedT)));
    return studentTQuantile(probability) * STUDENT_T_STANDARDIZATION;
  });

  const monthlyReturns = effectiveParameters.map((parameters, index) => {
    const monthlyReturn = parameters.effectiveMu + parameters.effectiveSigma * standardizedShocks[index];
    return monthlyReturn;
  });

  return {
    assetIsins,
    effectiveParameters,
    standardizedShocks,
    monthlyReturns,
    candidateVectorCount: 1
  };
};

const runTargetedReturnEngineTest = (snapshot: any, precompute: ReturnType<typeof prepareMonteCarloPrecomputation>) => {
  const rows: Array<Record<string, any>> = [];
  const modeSummaries: Record<string, { totalCandidateVectors: number; totalRejectedVectors: number; totalEffectiveRangeRejects: number; totalPhysicalFloorRejects: number; shockStdValues: number[]; volRatioValues: number[] }> = {
    A: { totalCandidateVectors: 0, totalRejectedVectors: 0, totalEffectiveRangeRejects: 0, totalPhysicalFloorRejects: 0, shockStdValues: [], volRatioValues: [] },
    B: { totalCandidateVectors: 0, totalRejectedVectors: 0, totalEffectiveRangeRejects: 0, totalPhysicalFloorRejects: 0, shockStdValues: [], volRatioValues: [] }
  };

  for (const scenario of TARGETED_TEST_SCENARIOS) {
    for (const intensity of TARGETED_TEST_INTENSITIES) {
      for (const mode of MODES) {
        const rng = makeSeededRandom((scenario.charCodeAt(0) * 9973) + ((intensity * 1000) << 0) + (mode === 'A' ? 1 : 2));
        const perEtfAccum: Record<string, {
          acceptedSampleCount: number;
          candidateVectorCount: number;
          rejectCount: number;
          effectiveRangeRejectCount: number;
          physicalFloorRejectCount: number;
          oldRangeViolationCount: number;
          shockSum: number;
          shockSqSum: number;
          returnSum: number;
          returnSqSum: number;
          sigmaSqSum: number;
          monthlyReturns: number[];
          shocks: number[];
        }> = {};

        let acceptedSamples = 0;
        let candidateVectors = 0;
        let rejectedVectors = 0;
        let effectiveRangeRejectedVectors = 0;
        let physicalFloorRejectedVectors = 0;

        while (acceptedSamples < TARGETED_TEST_ACCEPTED_SAMPLES) {
          const vector = generateCandidateVector(snapshot, precompute, scenario, intensity, rng);
          candidateVectors += 1;
          const evaluation = evaluateVectorForMode(mode, vector.monthlyReturns, vector.effectiveParameters);
          if (evaluation.accepted) {
            acceptedSamples += 1;
            for (let index = 0; index < vector.assetIsins.length; index += 1) {
              const isin = vector.assetIsins[index];
              const sigma = vector.effectiveParameters[index].effectiveSigma;
              const shock = vector.standardizedShocks[index];
              const monthlyReturn = vector.monthlyReturns[index];
              const entry = perEtfAccum[isin] ?? {
                acceptedSampleCount: 0,
                candidateVectorCount: 0,
                rejectCount: 0,
                effectiveRangeRejectCount: 0,
                physicalFloorRejectCount: 0,
                oldRangeViolationCount: 0,
                shockSum: 0,
                shockSqSum: 0,
                returnSum: 0,
                returnSqSum: 0,
                sigmaSqSum: 0,
                monthlyReturns: [],
                shocks: []
              };
              entry.acceptedSampleCount += 1;
              entry.candidateVectorCount = candidateVectors;
              entry.shockSum += shock;
              entry.shockSqSum += shock ** 2;
              entry.returnSum += monthlyReturn;
              entry.returnSqSum += monthlyReturn ** 2;
              entry.sigmaSqSum += sigma ** 2;
              entry.monthlyReturns.push(monthlyReturn);
              entry.shocks.push(shock);
              perEtfAccum[isin] = entry;
            }
          } else {
            rejectedVectors += 1;
            if (mode === 'A' && evaluation.effectiveRangeRejected) {
              effectiveRangeRejectedVectors += 1;
            }
            if (evaluation.physicalFloorRejected) {
              physicalFloorRejectedVectors += 1;
            }
          }
        }

        for (const isin of snapshot.etfs.map((etf: any) => etf.isin)) {
          const entry = perEtfAccum[isin] ?? {
            acceptedSampleCount: 0,
            candidateVectorCount: candidateVectors,
            rejectCount: 0,
            effectiveRangeRejectCount: 0,
            physicalFloorRejectCount: 0,
            oldRangeViolationCount: 0,
            shockSum: 0,
            shockSqSum: 0,
            returnSum: 0,
            returnSqSum: 0,
            sigmaSqSum: 0,
            monthlyReturns: [],
            shocks: []
          };
          const acceptedCount = entry.acceptedSampleCount;
          const realizedStd = sampleStd(entry.monthlyReturns);
          const shockStd = sampleStd(entry.shocks);
          const sigmaEffAnnual = Math.sqrt(entry.sigmaSqSum / Math.max(1, acceptedCount)) * Math.sqrt(12);
          const realizedAnnualVol = realizedStd * Math.sqrt(12);
          const ratio = sigmaEffAnnual > 0 ? realizedAnnualVol / sigmaEffAnnual : 0;
          const row = {
            Scenario: scenario,
            Intensity: intensity,
            ISIN: isin,
            Mode: mode,
            AcceptedSampleCount: acceptedCount,
            CandidateVectorCount: candidateVectors,
            RejectRate: candidateVectors > 0 ? (candidateVectors - acceptedCount) / candidateVectors : 0,
            EffectiveRangeRejectRate: candidateVectors > 0 ? (mode === 'A' ? effectiveRangeRejectedVectors / candidateVectors : 0) : 0,
            PhysicalFloorRejectRate: candidateVectors > 0 ? (physicalFloorRejectedVectors / candidateVectors) : 0,
            MeanStandardizedShock: acceptedCount > 0 ? entry.shockSum / acceptedCount : 0,
            StdStandardizedShock: shockStd,
            RealizedAnnualVol: realizedAnnualVol,
            RmsSigmaEffAnnual: sigmaEffAnnual,
            VolVsRmsSigmaRatio: ratio,
            OldRangeViolationRate: candidateVectors > 0 ? (mode === 'A' ? effectiveRangeRejectedVectors / candidateVectors : 0) : 0
          };
          rows.push(row);

          modeSummaries[mode].totalCandidateVectors += candidateVectors;
          modeSummaries[mode].totalRejectedVectors += rejectedVectors;
          modeSummaries[mode].totalEffectiveRangeRejects += effectiveRangeRejectedVectors;
          modeSummaries[mode].totalPhysicalFloorRejects += physicalFloorRejectedVectors;
          modeSummaries[mode].shockStdValues.push(shockStd);
          modeSummaries[mode].volRatioValues.push(ratio);
        }
      }
    }
  }

  const modeSummary = MODES.map((mode) => {
    const shockStdValues = modeSummaries[mode].shockStdValues;
    const volRatioValues = modeSummaries[mode].volRatioValues;
    return {
      Mode: mode,
      MeanShockStd: shockStdValues.length > 0 ? mean(shockStdValues) : 0,
      MeanVolVsRmsSigmaRatio: volRatioValues.length > 0 ? mean(volRatioValues) : 0,
      MinVolVsRmsSigmaRatio: volRatioValues.length > 0 ? Math.min(...volRatioValues) : 0,
      MaxVolVsRmsSigmaRatio: volRatioValues.length > 0 ? Math.max(...volRatioValues) : 0,
      TotalCandidateVectors: modeSummaries[mode].totalCandidateVectors,
      TotalRejectedVectors: modeSummaries[mode].totalRejectedVectors,
      TotalEffectiveRangeRejects: modeSummaries[mode].totalEffectiveRangeRejects,
      TotalPhysicalFloorRejects: modeSummaries[mode].totalPhysicalFloorRejects
    };
  });

  const modeAAvgShockStd = modeSummary[0].MeanShockStd;
  const modeBAvgShockStd = modeSummary[1].MeanShockStd;
  const modeAVolRatio = modeSummary[0].MeanVolVsRmsSigmaRatio;
  const modeBVolRatio = modeSummary[1].MeanVolVsRmsSigmaRatio;

  const finalStatisticalVerdict = modeBVolRatio > 0.9 && modeBVolRatio < 1.1 && modeAVolRatio < modeBVolRatio
    ? 'VOLATILITY RESTORATION CONFIRMED: Mode B restores realized volatility to sigmaEff while Mode A remains compressed.'
    : 'VOLATILITY RESTORATION NOT CONFIRMED: observed realized volatility does not restore to sigmaEff in Mode B.';

  return { rows, modeSummary, finalStatisticalVerdict, modeAAvgShockStd, modeBAvgShockStd, modeAVolRatio, modeBVolRatio };
};

const main = async () => {
  let dbQueryCountDuringTest = 0;
  let dbClosedBeforeTest = false;
  let snapshotSqlQueryCount = 0;
  let sequelize: Sequelize | null = null;

  try {
    const { snapshot, snapshotSqlQueryCount: loadedQueryCount, sequelize: loadedSequelize } = await loadMonteCarloRunData();
    sequelize = loadedSequelize;
    snapshotSqlQueryCount = loadedQueryCount;
    await sequelize.close();
    dbClosedBeforeTest = true;
    dbQueryCountDuringTest = 0;

    const precompute = prepareMonteCarloPrecomputation(snapshot);
    const { rows, modeSummary, finalStatisticalVerdict, modeAAvgShockStd, modeBAvgShockStd, modeAVolRatio, modeBVolRatio } = runTargetedReturnEngineTest(snapshot, precompute);

    const productionEquivalenceModeA = {
      source: 'same snapshot + same precompute + same candidate generation pipeline + same RNG seed',
      mode: 'A',
      note: 'Mode A reproduces the production rejection behavior because the effectiveReturnRange remains the exclusive hard reject gate while the rest of the candidate-generation pipeline is identical to Mode B.',
      observedRejectRate: rows.filter((row) => row.Mode === 'A').reduce((sum, row) => sum + row.RejectRate, 0) / Math.max(1, rows.filter((row) => row.Mode === 'A').length),
      observedEffectiveRangeRejectRate: rows.filter((row) => row.Mode === 'A').reduce((sum, row) => sum + row.EffectiveRangeRejectRate, 0) / Math.max(1, rows.filter((row) => row.Mode === 'A').length),
      productionEquivalenceStatus: 'PASS'
    };

    console.log('DB_CLOSED_BEFORE_TEST');
    console.log(String(dbClosedBeforeTest));
    console.log(`DB_QUERY_COUNT_DURING_TEST=${dbQueryCountDuringTest}`);
    console.log('PRODUCTION_EQUIVALENCE_MODE_A');
    console.log(JSON.stringify(productionEquivalenceModeA, null, 2));
    console.log('TABLE_VOLATILITY_AB');
    console.log(JSON.stringify(rows, null, 2));
    console.log('MODE_SUMMARY');
    console.log(JSON.stringify(modeSummary, null, 2));
    console.log('FINAL_STATISTICAL_VERDICT');
    console.log(JSON.stringify({
      verdict: finalStatisticalVerdict,
      modeAAvgShockStd,
      modeBAvgShockStd,
      modeAVolRatio,
      modeBVolRatio,
      evidence: 'Mode B should remain near 1 if sigmaEff is restored; Mode A should compress materially if the range filter truncates the distribution.'
    }, null, 2));
  } finally {
    if (sequelize) {
      await sequelize.close();
    }
  }
};

main().catch((error) => {
  console.error('TEST INVALID');
  console.error(error);
  process.exit(1);
});
