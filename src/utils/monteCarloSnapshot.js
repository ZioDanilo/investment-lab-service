const MACRO_SCENARIOS = ['expansion', 'recession', 'stagflation', 'soft_landing'];
const REQUIRED_STATISTICS_SCENARIOS = [...MACRO_SCENARIOS, 'general'];
const REQUIRED_GLOBAL_PROPERTIES = [
  'scenario_transition_intensity_threshold',
  'new_scenario_first_month_max_intensity',
  'new_scenario_second_month_max_intensity',
  'scenario_intensity_max_monthly_variation'
];
const EPSILON = 1e-9;

class MonteCarloSnapshotValidationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MonteCarloSnapshotValidationError';
    this.code = code;
    this.details = details;
    this.statusCode = 422;
  }
}

const fail = (code, message, details) => {
  throw new MonteCarloSnapshotValidationError(code, message, details);
};

const asFiniteNumber = (value, field, details) => {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    fail('INVALID_NUMERIC_VALUE', `${field} must be a finite number`, details);
  }
  return number;
};

const assertRange = (value, minimum, maximum, field, details) => {
  if (value < minimum || value > maximum) {
    fail('INVALID_VALUE_RANGE', `${field} must be in [${minimum}, ${maximum}]`, details);
  }
};

const assertRequiredScenarioRows = (rows, scenarioField, entity) => {
  const byScenario = new Map();
  for (const row of rows) {
    const scenario = row[scenarioField];
    if (!REQUIRED_STATISTICS_SCENARIOS.includes(scenario)) {
      fail('INVALID_SCENARIO', `${entity} contains an unsupported scenario`, { scenario, row });
    }
    if (byScenario.has(scenario)) {
      fail('DUPLICATE_SCENARIO_CONFIGURATION', `${entity} contains duplicate scenario ${scenario}`, { scenario });
    }
    byScenario.set(scenario, row);
  }

  const missing = REQUIRED_STATISTICS_SCENARIOS.filter((scenario) => !byScenario.has(scenario));
  if (missing.length > 0) {
    fail('MISSING_ETF_MACRO_STATISTICS', `${entity} is missing required scenario statistics`, { missing });
  }
  return byScenario;
};

const mapStatistics = (isin, rows) => {
  const byScenario = assertRequiredScenarioRows(rows, 'macroScenario', `ETF ${isin}`);
  const statistics = {};

  for (const scenario of REQUIRED_STATISTICS_SCENARIOS) {
    const row = byScenario.get(scenario);
    // Existing financial rows are persisted as percentage points. Conversion is centralized here.
    const expectedReturn = asFiniteNumber(row.expectedReturn, 'expectedReturn', { isin, scenario }) / 100;
    const volatility = asFiniteNumber(row.volatility, 'volatility', { isin, scenario }) / 100;
    const rangeMin = asFiniteNumber(row.returnRangeMin, 'returnRangeMin', { isin, scenario }) / 100;
    const rangeMax = asFiniteNumber(row.returnRangeMax, 'returnRangeMax', { isin, scenario }) / 100;
    const hasMaxDrawdown = row.maxDrawdown !== null && row.maxDrawdown !== undefined && row.maxDrawdown !== '';
    const maxDrawdown = hasMaxDrawdown
      ? asFiniteNumber(row.maxDrawdown, 'maxDrawdown', { isin, scenario }) / 100
      : undefined;

    if (expectedReturn <= -1) {
      fail('INVALID_EXPECTED_RETURN', 'expectedReturn must be greater than -1', { isin, scenario, expectedReturn });
    }
    if (volatility < 0) {
      fail('INVALID_VOLATILITY', 'volatility must be greater than or equal to zero', { isin, scenario, volatility });
    }
    if (maxDrawdown !== undefined && maxDrawdown > 0) {
      fail('INVALID_MAX_DRAWDOWN', 'maxDrawdown must be negative or zero', { isin, scenario, maxDrawdown });
    }
    if (rangeMin < -1 || rangeMin > expectedReturn || expectedReturn > rangeMax) {
      fail('INVALID_RETURN_RANGE', 'return range must contain expectedReturn and have minimum at least -1', {
        isin,
        scenario,
        rangeMin,
        expectedReturn,
        rangeMax
      });
    }
    if (volatility === 0 && rangeMin !== expectedReturn && rangeMax !== expectedReturn) {
      fail('INVALID_ZERO_VOLATILITY_RANGE', 'zero volatility requires return range equal to expectedReturn', {
        isin,
        scenario,
        rangeMin,
        expectedReturn,
        rangeMax
      });
    }

    const statistic = {
      expectedReturn,
      volatility,
      returnRange: { min: rangeMin, max: rangeMax }
    };
    if (maxDrawdown !== undefined) {
      statistic.maxDrawdown = maxDrawdown;
    }
    statistics[scenario] = statistic;
  }

  return statistics;
};

const mapStructuralProbabilities = (rows) => {
  const values = new Map();
  for (const row of rows) {
    if (!MACRO_SCENARIOS.includes(row.scenario)) {
      fail('INVALID_SCENARIO', 'structural probability contains an unsupported scenario', { scenario: row.scenario });
    }
    if (values.has(row.scenario)) {
      fail('DUPLICATE_STRUCTURAL_PROBABILITY', 'duplicate structural probability', { scenario: row.scenario });
    }
    const probability = asFiniteNumber(row.probability, 'structural probability', { scenario: row.scenario });
    assertRange(probability, 0, 1, 'structural probability', { scenario: row.scenario, probability });
    values.set(row.scenario, probability);
  }

  const missing = MACRO_SCENARIOS.filter((scenario) => !values.has(scenario));
  if (missing.length > 0) {
    fail('MISSING_STRUCTURAL_PROBABILITY', 'missing structural probabilities', { missing });
  }
  const total = [...values.values()].reduce((sum, value) => sum + value, 0);
  if (Math.abs(total - 1) > EPSILON) {
    fail('INVALID_STRUCTURAL_PROBABILITY_SUM', 'structural probabilities must sum to 1', { total, epsilon: EPSILON });
  }
  return Object.fromEntries(values);
};

const mapTransitionMatrix = (rows) => {
  const values = new Map();
  for (const row of rows) {
    const { fromScenario, toScenario } = row;
    if (!MACRO_SCENARIOS.includes(fromScenario) || !MACRO_SCENARIOS.includes(toScenario)) {
      fail('INVALID_SCENARIO', 'transition matrix contains an unsupported scenario', { fromScenario, toScenario });
    }
    const key = `${fromScenario}:${toScenario}`;
    if (values.has(key)) {
      fail('DUPLICATE_TRANSITION', 'duplicate transition matrix row', { fromScenario, toScenario });
    }
    const probability = asFiniteNumber(row.probability, 'transition probability', { fromScenario, toScenario });
    assertRange(probability, 0, 1, 'transition probability', { fromScenario, toScenario, probability });
    values.set(key, probability);
  }

  const matrix = {};
  for (const fromScenario of MACRO_SCENARIOS) {
    matrix[fromScenario] = {};
    for (const toScenario of MACRO_SCENARIOS) {
      const probability = values.get(`${fromScenario}:${toScenario}`);
      if (probability === undefined) {
        fail('MISSING_TRANSITION', 'missing transition matrix row', { fromScenario, toScenario });
      }
      matrix[fromScenario][toScenario] = probability;
    }
    const total = Object.values(matrix[fromScenario]).reduce((sum, value) => sum + value, 0);
    if (Math.abs(total - 1) > EPSILON) {
      fail('INVALID_TRANSITION_SUM', 'transition probabilities must sum to 1 for each source scenario', {
        fromScenario,
        total,
        epsilon: EPSILON
      });
    }
  }
  return matrix;
};

const mapScenarioConfigurations = (rows, entity, mapper) => {
  const byScenario = new Map();
  for (const row of rows) {
    if (!MACRO_SCENARIOS.includes(row.scenario)) {
      fail('INVALID_SCENARIO', `${entity} contains an unsupported scenario`, { scenario: row.scenario });
    }
    if (byScenario.has(row.scenario)) {
      fail('DUPLICATE_SCENARIO_CONFIGURATION', `${entity} contains duplicate scenario ${row.scenario}`, { scenario: row.scenario });
    }
    byScenario.set(row.scenario, mapper(row));
  }
  const missing = MACRO_SCENARIOS.filter((scenario) => !byScenario.has(scenario));
  if (missing.length > 0) {
    fail('MISSING_SCENARIO_CONFIGURATION', `${entity} is missing configurations`, { entity, missing });
  }
  return Object.fromEntries(byScenario);
};

const mapInertiaConfigurations = (rows) => mapScenarioConfigurations(rows, 'inertia configuration', (row) => {
  const details = { scenario: row.scenario };
  const entryProbability = asFiniteNumber(row.entryProbability, 'entryProbability', details);
  const persistenceProbability = asFiniteNumber(row.persistenceProbability, 'persistenceProbability', details);
  const entryMonths = asFiniteNumber(row.entryMonths, 'entryMonths', details);
  const exitStartMonth = asFiniteNumber(row.exitStartMonth, 'exitStartMonth', details);
  const exitDecay = asFiniteNumber(row.exitDecay, 'exitDecay', details);
  assertRange(entryProbability, 0, 1, 'entryProbability', details);
  assertRange(persistenceProbability, 0, 1, 'persistenceProbability', details);
  assertRange(exitDecay, 0, 1, 'exitDecay', details);
  if (!Number.isInteger(entryMonths) || entryMonths < 1 || !Number.isInteger(exitStartMonth) || exitStartMonth <= entryMonths) {
    fail('INVALID_INERTIA_CONFIGURATION', 'inertia months must be integers and exitStartMonth must exceed entryMonths', details);
  }
  return { entryProbability, persistenceProbability, entryMonths, exitStartMonth, exitDecay };
});

const mapIntensityConfigurations = (rows) => mapScenarioConfigurations(rows, 'intensity configuration', (row) => {
  const details = { scenario: row.scenario };
  const meanIntensity = asFiniteNumber(row.meanIntensity, 'meanIntensity', details);
  const stdDevIntensity = asFiniteNumber(row.stdDevIntensity, 'stdDevIntensity', details);
  assertRange(meanIntensity, 0, 1, 'meanIntensity', details);
  if (stdDevIntensity <= 0) {
    fail('INVALID_INTENSITY_CONFIGURATION', 'stdDevIntensity must be greater than zero', details);
  }
  return { meanIntensity, stdDevIntensity };
});

const mapGlobalProperties = (rows) => {
  const values = new Map();
  for (const row of rows) {
    if (values.has(row.propertyKey)) {
      fail('DUPLICATE_GLOBAL_PROPERTY', 'duplicate global property', { propertyKey: row.propertyKey });
    }
    values.set(row.propertyKey, asFiniteNumber(row.value, 'global property value', { propertyKey: row.propertyKey }));
  }
  const missing = REQUIRED_GLOBAL_PROPERTIES.filter((key) => !values.has(key));
  if (missing.length > 0) {
    fail('MISSING_GLOBAL_PROPERTY', 'missing required global properties', { missing });
  }
  const properties = {};
  for (const key of REQUIRED_GLOBAL_PROPERTIES) {
    const value = values.get(key);
    assertRange(value, 0, 1, 'global property value', { propertyKey: key, value });
    properties[key] = value;
  }
  return properties;
};

const correlationKey = (isin1, isin2) => [isin1, isin2].sort().join(':');

const mapCorrelations = (isins, rows) => {
  const isinSet = new Set(isins);
  const values = new Map();
  for (const row of rows) {
    if (!isinSet.has(row.isin1) || !isinSet.has(row.isin2)) continue;
    if (row.isin1 === row.isin2) {
      fail('SELF_ETF_CORRELATION', 'self-correlation is not permitted', { isin: row.isin1, id: row.id });
    }
    const key = correlationKey(row.isin1, row.isin2);
    if (values.has(key)) {
      fail('DUPLICATE_ETF_CORRELATION', 'duplicate ETF correlation', {
        isin1: row.isin1,
        isin2: row.isin2,
        recordIds: [values.get(key).id, row.id]
      });
    }
    const mapped = { isin1: row.isin1, isin2: row.isin2 };
    for (const scenario of MACRO_SCENARIOS) {
      const correlation = asFiniteNumber(row[scenario], 'correlation', { isin1: row.isin1, isin2: row.isin2, scenario });
      assertRange(correlation, -1, 1, 'correlation', { isin1: row.isin1, isin2: row.isin2, scenario, correlation });
      mapped[scenario] = correlation;
    }
    values.set(key, { ...mapped, id: row.id });
  }

  const correlations = [];
  for (let left = 0; left < isins.length; left += 1) {
    for (let right = left + 1; right < isins.length; right += 1) {
      const isin1 = isins[left];
      const isin2 = isins[right];
      const correlation = values.get(correlationKey(isin1, isin2));
      if (!correlation) {
        fail('MISSING_ETF_CORRELATION', 'missing ETF correlation', { isin1, isin2, scenarios: MACRO_SCENARIOS });
      }
      const { id, ...payload } = correlation;
      correlations.push(payload);
    }
  }
  return correlations;
};

const buildMonteCarloSnapshot = ({ isins, etfs, macroStatistics, structuralProbabilities, transitions, inertiaConfigurations, intensityConfigurations, globalProperties, correlations }) => {
  if (!Array.isArray(isins) || isins.length === 0 || isins.some((isin) => typeof isin !== 'string' || isin.trim() === '')) {
    fail('INVALID_SNAPSHOT_REQUEST', 'isins must be a non-empty array of non-empty strings');
  }
  if (new Set(isins).size !== isins.length) {
    fail('DUPLICATE_ETF', 'snapshot request contains duplicate ISINs', { isins });
  }

  const etfByIsin = new Map(etfs.map((etf) => [etf.isin, etf]));
  const missingEtfs = isins.filter((isin) => !etfByIsin.has(isin));
  if (missingEtfs.length > 0) {
    fail('MISSING_ETF', 'requested ETFs do not exist', { missingEtfs });
  }
  if (etfByIsin.size !== etfs.length) {
    fail('DUPLICATE_ETF', 'database returned duplicate ETF ISINs');
  }

  const statisticsByIsin = new Map();
  for (const row of macroStatistics) {
    if (!etfByIsin.has(row.isin)) continue;
    const rows = statisticsByIsin.get(row.isin) || [];
    rows.push(row);
    statisticsByIsin.set(row.isin, rows);
  }

  const snapshotEtfs = isins.map((isin) => {
    const etf = etfByIsin.get(isin);
    return {
      isin,
      name: etf.name,
      nickname: etf.nickname ?? null,
      statistics: mapStatistics(isin, statisticsByIsin.get(isin) || [])
    };
  });

  return {
    etfs: snapshotEtfs,
    structuralProbabilities: mapStructuralProbabilities(structuralProbabilities),
    transitionMatrix: mapTransitionMatrix(transitions),
    inertiaConfigurations: mapInertiaConfigurations(inertiaConfigurations),
    intensityConfigurations: mapIntensityConfigurations(intensityConfigurations),
    globalProperties: mapGlobalProperties(globalProperties),
    correlations: mapCorrelations(isins, correlations)
  };
};

module.exports = {
  EPSILON,
  MACRO_SCENARIOS,
  REQUIRED_GLOBAL_PROPERTIES,
  MonteCarloSnapshotValidationError,
  buildMonteCarloSnapshot
};