process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://snapshot-test:snapshot-test@localhost:5432/snapshot_test';

const {
  buildMonteCarloSnapshot,
  MonteCarloSnapshotValidationError,
  MACRO_SCENARIOS,
  REQUIRED_GLOBAL_PROPERTIES
} = require('./utils/monteCarloSnapshot');
const monteCarloController = require('./controllers/monteCarloController');
const ETF = require('./models/ETF');
const EtfMacroStatistics = require('./models/EtfMacroStatistics');
const StructuralProbability = require('./models/StructuralProbability');
const TransitionMatrix = require('./models/TransitionMatrix');
const ScenarioInertiaConfiguration = require('./models/ScenarioInertiaConfiguration');
const ScenarioIntensityConfiguration = require('./models/ScenarioIntensityConfiguration');
const MonteCarloGlobalProperty = require('./models/MonteCarloGlobalProperty');
const EtfCorrelation = require('./models/EtfCorrelation');

const createStatistics = (isin) => [...MACRO_SCENARIOS, 'general'].map((macroScenario) => ({
  isin,
  macroScenario,
  expectedReturn: '8',
  volatility: '12',
  maxDrawdown: '-25',
  returnRangeMin: '-20',
  returnRangeMax: '30'
}));

const createFixture = () => {
  const isins = ['ETF-A', 'ETF-B'];
  return {
    isins,
    etfs: isins.map((isin) => ({ isin, name: `Name ${isin}`, nickname: null })),
    macroStatistics: isins.flatMap(createStatistics),
    structuralProbabilities: MACRO_SCENARIOS.map((scenario) => ({ scenario, probability: '0.25' })),
    transitions: MACRO_SCENARIOS.flatMap((fromScenario) => MACRO_SCENARIOS.map((toScenario) => ({
      fromScenario,
      toScenario,
      probability: '0.25'
    }))),
    inertiaConfigurations: MACRO_SCENARIOS.map((scenario) => ({
      scenario,
      entryProbability: '0.6',
      persistenceProbability: '0.7',
      entryMonths: 2,
      exitStartMonth: 3,
      exitDecay: '0.1'
    })),
    intensityConfigurations: MACRO_SCENARIOS.map((scenario) => ({
      scenario,
      meanIntensity: '0.5',
      stdDevIntensity: '0.1'
    })),
    globalProperties: [
      { propertyKey: 'scenario_transition_intensity_threshold', value: '0.60' },
      { propertyKey: 'new_scenario_first_month_max_intensity', value: '0.40' },
      { propertyKey: 'new_scenario_second_month_max_intensity', value: '0.70' },
      { propertyKey: 'scenario_intensity_max_monthly_variation', value: '0.40' }
    ],
    correlations: [{
      id: 'correlation-1',
      isin1: 'ETF-A',
      isin2: 'ETF-B',
      expansion: '0.2',
      recession: '0.3',
      stagflation: '0.4',
      soft_landing: '0.5'
    }]
  };
};

describe('buildMonteCarloSnapshot', () => {
  test('returns a complete snapshot with financial values converted once to decimals', () => {
    const snapshot = buildMonteCarloSnapshot(createFixture());

    expect(snapshot.etfs).toHaveLength(2);
    expect(snapshot.etfs[0].statistics.expansion).toEqual({
      expectedReturn: 0.08,
      volatility: 0.12,
      maxDrawdown: -0.25,
      returnRange: { min: -0.2, max: 0.3 }
    });
    expect(snapshot.structuralProbabilities).toEqual({
      expansion: 0.25,
      recession: 0.25,
      stagflation: 0.25,
      soft_landing: 0.25
    });
    expect(snapshot.transitionMatrix.expansion).toHaveProperty('recession', 0.25);
    expect(snapshot.globalProperties).toEqual({
      scenario_transition_intensity_threshold: 0.6,
      new_scenario_first_month_max_intensity: 0.4,
      new_scenario_second_month_max_intensity: 0.7,
      scenario_intensity_max_monthly_variation: 0.4
    });
    expect(snapshot.correlations).toEqual([{
      isin1: 'ETF-A',
      isin2: 'ETF-B',
      expansion: 0.2,
      recession: 0.3,
      stagflation: 0.4,
      soft_landing: 0.5
    }]);
    expect(snapshot).not.toHaveProperty('targetWeights');
  });

  test('does not require or return maxDrawdown when it is absent from ETF statistics', () => {
    const fixture = createFixture();
    for (const statistic of fixture.macroStatistics) {
      statistic.maxDrawdown = null;
    }

    const snapshot = buildMonteCarloSnapshot(fixture);

    for (const etf of snapshot.etfs) {
      for (const scenario of [...MACRO_SCENARIOS, 'general']) {
        expect(etf.statistics[scenario]).not.toHaveProperty('maxDrawdown');
      }
    }
  });

  test.each([
    ['missing ETF macro scenario', (fixture) => fixture.macroStatistics.splice(0, 1), 'MISSING_ETF_MACRO_STATISTICS'],
    ['duplicate ETF macro scenario', (fixture) => fixture.macroStatistics.push({ ...fixture.macroStatistics[0] }), 'DUPLICATE_SCENARIO_CONFIGURATION'],
    ['invalid structural total', (fixture) => { fixture.structuralProbabilities[0].probability = '0.5'; }, 'INVALID_STRUCTURAL_PROBABILITY_SUM'],
    ['duplicate structural probability', (fixture) => fixture.structuralProbabilities.push({ ...fixture.structuralProbabilities[0] }), 'DUPLICATE_STRUCTURAL_PROBABILITY'],
    ['missing transition row', (fixture) => fixture.transitions.pop(), 'MISSING_TRANSITION'],
    ['duplicate transition row', (fixture) => fixture.transitions.push({ ...fixture.transitions[0] }), 'DUPLICATE_TRANSITION'],
    ['duplicate requested ETF', (fixture) => fixture.isins.push('ETF-A'), 'DUPLICATE_ETF'],
    ['missing correlation pair', (fixture) => { fixture.correlations = []; }, 'MISSING_ETF_CORRELATION'],
    ['duplicate reverse correlation pair', (fixture) => fixture.correlations.push({ ...fixture.correlations[0], id: 'correlation-2', isin1: 'ETF-B', isin2: 'ETF-A' }), 'DUPLICATE_ETF_CORRELATION'],
    ['invalid correlation', (fixture) => { fixture.correlations[0].expansion = '1.1'; }, 'INVALID_VALUE_RANGE'],
    ['missing global property', (fixture) => fixture.globalProperties.pop(), 'MISSING_GLOBAL_PROPERTY'],
    ['duplicate global property', (fixture) => fixture.globalProperties.push({ ...fixture.globalProperties[0] }), 'DUPLICATE_GLOBAL_PROPERTY'],
    ['invalid monthly intensity variation', (fixture) => { fixture.globalProperties[3].value = '1.1'; }, 'INVALID_VALUE_RANGE']
  ])('fails fast for %s', (_name, mutate, code) => {
    const fixture = createFixture();
    mutate(fixture);

    expect(() => buildMonteCarloSnapshot(fixture)).toThrow(MonteCarloSnapshotValidationError);
    try {
      buildMonteCarloSnapshot(fixture);
    } catch (error) {
      expect(error.code).toBe(code);
    }
  });
});

describe('POST /api/monte-carlo/snapshot controller', () => {
  const mockSnapshotQueries = (fixture) => {
    jest.spyOn(ETF, 'findAll').mockResolvedValue(fixture.etfs);
    jest.spyOn(EtfMacroStatistics, 'findAll').mockResolvedValue(fixture.macroStatistics);
    jest.spyOn(StructuralProbability, 'findAll').mockResolvedValue(fixture.structuralProbabilities);
    jest.spyOn(TransitionMatrix, 'findAll').mockResolvedValue(fixture.transitions);
    jest.spyOn(ScenarioInertiaConfiguration, 'findAll').mockResolvedValue(fixture.inertiaConfigurations);
    jest.spyOn(ScenarioIntensityConfiguration, 'findAll').mockResolvedValue(fixture.intensityConfigurations);
    jest.spyOn(MonteCarloGlobalProperty, 'findAll').mockResolvedValue(fixture.globalProperties);
    jest.spyOn(EtfCorrelation, 'findAll').mockResolvedValue(fixture.correlations);
  };

  beforeEach(() => monteCarloController.clearMonteCarloCaches());
  afterEach(() => {
    monteCarloController.clearMonteCarloCaches();
    jest.restoreAllMocks();
  });

  test('returns the complete validated decimal snapshot without target weights', async () => {
    const fixture = createFixture();
    mockSnapshotQueries(fixture);
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    const next = jest.fn();

    await monteCarloController.getSnapshot({ body: { isins: fixture.isins } }, { status, json }, next);

    expect(status).toHaveBeenCalledWith(200);
    expect(next).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        etfs: expect.any(Array),
        structuralProbabilities: expect.any(Object),
        transitionMatrix: expect.any(Object),
        inertiaConfigurations: expect.any(Object),
        intensityConfigurations: expect.any(Object),
        globalProperties: expect.any(Object),
        correlations: expect.any(Array)
      })
    }));
    expect(json.mock.calls[0][0].data).not.toHaveProperty('targetWeights');
  });

  test('forwards structural validation errors without emitting a partial snapshot', async () => {
    const fixture = createFixture();
    fixture.correlations = [];
    mockSnapshotQueries(fixture);
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    const next = jest.fn();

    await monteCarloController.getSnapshot({ body: { isins: fixture.isins } }, { status, json }, next);

    expect(status).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      code: 'MISSING_ETF_CORRELATION',
      statusCode: 422
    }));
  });

  test('reuses cached snapshot for identical requests to avoid repeated DB reads', async () => {
    const fixture = createFixture();
    mockSnapshotQueries(fixture);
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    const next = jest.fn();

    await monteCarloController.getSnapshot({ body: { isins: fixture.isins } }, { status, json }, next);
    await monteCarloController.getSnapshot({ body: { isins: fixture.isins } }, { status, json }, next);

    expect(ETF.findAll).toHaveBeenCalledTimes(1);
    expect(EtfMacroStatistics.findAll).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledTimes(2);
  });
});