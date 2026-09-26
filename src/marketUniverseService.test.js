process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://snapshot-test:snapshot-test@localhost:5432/snapshot_test';

const ETF = require('./models/ETF');
const EtfMacroStatistics = require('./models/EtfMacroStatistics');
const EtfCorrelation = require('./models/EtfCorrelation');
const StructuralProbability = require('./models/StructuralProbability');
const TransitionMatrix = require('./models/TransitionMatrix');
const ScenarioInertiaConfiguration = require('./models/ScenarioInertiaConfiguration');
const ScenarioIntensityConfiguration = require('./models/ScenarioIntensityConfiguration');
const MonteCarloGlobalProperty = require('./models/MonteCarloGlobalProperty');
const MarketUniverseRun = require('./models/MarketUniverseRun');
const MarketUniverseMonth = require('./models/MarketUniverseMonth');
const { sequelize, initializeAssociations } = require('./config/database');
const { MarketUniverseService } = require('./services/marketUniverseService');

describe('Market Universe Service', () => {
  const fixtureEtfs = [
    {
      id: 'asset-1',
      isin: 'IE00BL25JP72',
      name: 'Momentum',
      nickname: 'Momentum',
      ticker: 'XDEM.MI',
      description: 'Trend and growth ETF',
      assetClass: 'Equity',
      expense: '0.25',
      historicalData: [],
      metrics: { yield: null, volatility: null, beta: null },
      longTermExpectedReturn: '8.5',
      calibratedAt: '2024-01-01T00:00:00.000Z',
      lastCalibrationMedianCagr: '7.5'
    }
  ];

  const fixtureMacroStats = [
    { isin: 'IE00BL25JP72', macroScenario: 'expansion', expectedReturn: '8.5', volatility: '12.3', maxDrawdown: '-25', returnRangeMin: '-10', returnRangeMax: '30' },
    { isin: 'IE00BL25JP72', macroScenario: 'soft_landing', expectedReturn: '7.1', volatility: '10.4', maxDrawdown: '-18', returnRangeMin: '-8', returnRangeMax: '24' },
    { isin: 'IE00BL25JP72', macroScenario: 'recession', expectedReturn: '-6.2', volatility: '14.1', maxDrawdown: '-32', returnRangeMin: '-20', returnRangeMax: '18' },
    { isin: 'IE00BL25JP72', macroScenario: 'stagflation', expectedReturn: '3.4', volatility: '16.8', maxDrawdown: '-28', returnRangeMin: '-12', returnRangeMax: '20' },
    { isin: 'IE00BL25JP72', macroScenario: 'general', expectedReturn: '6.8', volatility: '11.4', maxDrawdown: '-24', returnRangeMin: '-14', returnRangeMax: '24' }
  ];

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  test('initializes associations for the direct-service execution path', () => {
    initializeAssociations();

    expect(ETF.associations.macroStats).toBeDefined();
    expect(EtfMacroStatistics.associations.ETF || EtfMacroStatistics.associations.etf).toBeDefined();
    expect(MarketUniverseRun.associations.months).toBeDefined();
    expect(MarketUniverseMonth.associations.marketUniverseRun || MarketUniverseMonth.associations.MarketUniverseRun).toBeDefined();
  });

  test('uses the canonical 30-year production default horizon', () => {
    const serviceSource = MarketUniverseService.regenerateMarketUniverse.toString();

    expect(serviceSource).toContain('pathCount = 1000');
    expect(serviceSource).toContain('monthCount = 360');
  });

  test('converts all backend ETF rows into canonical MarketAsset entries', async () => {
    jest.spyOn(ETF, 'findAll').mockResolvedValue(fixtureEtfs);
    jest.spyOn(EtfMacroStatistics, 'findAll').mockResolvedValue(fixtureMacroStats);

    const assets = await MarketUniverseService.getAllAssets();

    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({
      id: 'asset-1',
      isin: 'IE00BL25JP72',
      ticker: 'XDEM.MI',
      name: 'Momentum',
      assetClass: 'Equity',
      expectedReturn: 0.085,
      volatility: 0.114,
      maxDrawdown: -0.24,
      returnRangeMin: -0.14,
      returnRangeMax: 0.24
    });
    expect(assets[0].expansion.expectedReturn).toBeCloseTo(0.085, 12);
    expect(assets[0].expansion.volatility).toBeCloseTo(0.123, 12);
    expect(assets[0].expansion.maxDrawdown).toBeCloseTo(-0.25, 12);
    expect(assets[0].soft_landing.expectedReturn).toBeCloseTo(0.071, 12);
    expect(assets[0].soft_landing.volatility).toBeCloseTo(0.104, 12);
    expect(assets[0].general.expectedReturn).toBeCloseTo(0.068, 12);
    expect(assets[0].general.volatility).toBeCloseTo(0.114, 12);
  });

  test('resolves asset by id and by isin using the canonical view', async () => {
    jest.spyOn(ETF, 'findAll').mockResolvedValue(fixtureEtfs);
    jest.spyOn(EtfMacroStatistics, 'findAll').mockResolvedValue(fixtureMacroStats);

    const byId = await MarketUniverseService.getAssetById('asset-1');
    const byIsin = await MarketUniverseService.getAssetByIsin('IE00BL25JP72');

    expect(byId.id).toBe('asset-1');
    expect(byIsin.isin).toBe('IE00BL25JP72');
    expect(byId).toEqual(byIsin);
  });

  test('keeps ISIN unique and preserves scenario names without arbitrary conversion', async () => {
    const withDuplicateIsin = [
      ...fixtureEtfs,
      { ...fixtureEtfs[0], id: 'asset-2', isin: 'IE00BL25JP72' }
    ];

    jest.spyOn(ETF, 'findAll').mockResolvedValue(withDuplicateIsin);
    jest.spyOn(EtfMacroStatistics, 'findAll').mockResolvedValue(fixtureMacroStats);

    const assets = await MarketUniverseService.getAllAssets();
    const uniqueIsins = new Set(assets.map((asset) => asset.isin));

    expect(uniqueIsins.size).toBe(assets.length);
    expect(assets[0]).toHaveProperty('expansion');
    expect(assets[0]).toHaveProperty('soft_landing');
    expect(assets[0]).toHaveProperty('recession');
    expect(assets[0]).toHaveProperty('stagflation');
    expect(assets[0]).toHaveProperty('general');
    expect(assets[0]).not.toHaveProperty('softLanding');
  });

  test('keeps legacy fallback behavior available while marking it explicitly as legacy', async () => {
    const legacyFallback = [{
      id: 'legacy-1',
      isin: 'LEGACY-ISIN',
      name: 'Legacy ETF',
      ticker: 'LEG',
      compartment: 'Legacy',
      mission: 'Fallback only',
      weight: 0.5,
      expectedReturn: 0.08,
      volatility: 0.12,
      maxDrawdown: -0.2,
      ter: 0.002,
      liquidity: 5,
      recession: 0.05,
      stagflation: 0.07
    }];

    const assets = await MarketUniverseService.getAllAssets({ legacyFallback });

    expect(assets[0]).toMatchObject({
      id: 'legacy-1',
      isin: 'LEGACY-ISIN',
      name: 'Legacy ETF',
      source: 'legacy-fallback'
    });
    expect(assets[0]).toHaveProperty('legacyFallback');
  });

  test('keeps portfolio loading compatibility with legacy holdings path', async () => {
    const holdings = [{
      isin: 'IE00BL25JP72',
      weight: 0.5,
      name: 'Momentum',
      ticker: 'XDEM.MI'
    }];

    jest.spyOn(ETF, 'findAll').mockResolvedValue(fixtureEtfs);
    jest.spyOn(EtfMacroStatistics, 'findAll').mockResolvedValue(fixtureMacroStats);

    const assets = await MarketUniverseService.getAllAssets();
    const portfolioAssets = MarketUniverseService.rehydrateLegacyPortfolioHoldings(holdings, assets);

    expect(portfolioAssets).toHaveLength(1);
    expect(portfolioAssets[0]).toMatchObject({
      isin: 'IE00BL25JP72',
      name: 'Momentum',
      weight: 0.5
    });
  });

  test('buildMarketUniverse returns canonical market assets and counts completeness', async () => {
    jest.spyOn(ETF, 'findAll').mockResolvedValue(fixtureEtfs);
    jest.spyOn(EtfMacroStatistics, 'findAll').mockResolvedValue(fixtureMacroStats);

    const result = await MarketUniverseService.buildMarketUniverse();

    expect(result.success).toBe(true);
    expect(result.assetCount).toBe(1);
    expect(result.completeAssetCount).toBe(1);
    expect(result.incompleteAssetCount).toBe(0);
    expect(result.legacyAssetCount).toBe(0);
    expect(result.assets[0]).toMatchObject({
      isin: 'IE00BL25JP72',
      name: 'Momentum'
    });
  });

  test('regenerateMarketUniverse fails on duplicate ISIN and preserves a clear error', async () => {
    const duplicateEtfs = [
      ...fixtureEtfs,
      { ...fixtureEtfs[0], id: 'asset-2', isin: 'IE00BL25JP72', name: 'Momentum Duplicate' }
    ];

    jest.spyOn(ETF, 'findAll').mockResolvedValue(duplicateEtfs);
    jest.spyOn(EtfMacroStatistics, 'findAll').mockResolvedValue(fixtureMacroStats);

    await expect(MarketUniverseService.regenerateMarketUniverse()).rejects.toMatchObject({
      code: 'DUPLICATE_ISIN'
    });
  });

  test('regenerateMarketUniverse fails on DB read error without using legacy fallback', async () => {
    jest.spyOn(ETF, 'findAll').mockRejectedValue(new Error('db down'));

    await expect(MarketUniverseService.regenerateMarketUniverse()).rejects.toMatchObject({
      code: 'MARKET_UNIVERSE_READ_FAILED'
    });
  });

  test('retries transient DB failures for bulk create without duplicating logical rows', async () => {
    await jest.unstable_mockModule('investment-lab-core', () => ({
      derivePathSeed: jest.fn(() => 1234),
      prepareMonteCarloPrecomputation: jest.fn(() => ({})),
      generateMonthlyMacroTimeline: jest.fn(() => ({ months: [{ scenario: 'expansion', intensity: 0.5 }, { scenario: 'recession', intensity: 0.4 }] })),
      generateMonthlyReturnVector: jest.fn(() => ({ etfReturns: [{ monthlyReturn: 0.01 }, { monthlyReturn: 0.02 }] })),
      SeededRandom: class MockSeededRandom {
        constructor() {}
        next() { return 0.5; }
      }
    }));
    const runtime = await import('investment-lab-core');

    const marketUniverseEtfs = [
      ...fixtureEtfs,
      {
        id: 'asset-2',
        isin: 'IE00BL25JP73',
        name: 'Quality',
        nickname: 'Quality',
        ticker: 'XQQQ.MI',
        description: 'Quality ETF',
        assetClass: 'Equity',
        expense: '0.30',
        historicalData: [],
        metrics: { yield: null, volatility: null, beta: null },
        longTermExpectedReturn: '7.8',
        calibratedAt: '2024-01-01T00:00:00.000Z',
        lastCalibrationMedianCagr: '6.8'
      }
    ];
    const marketUniverseMacroStats = [
      ...fixtureMacroStats,
      { isin: 'IE00BL25JP73', macroScenario: 'expansion', expectedReturn: '7.8', volatility: '11.5', maxDrawdown: '-22', returnRangeMin: '-9', returnRangeMax: '28' },
      { isin: 'IE00BL25JP73', macroScenario: 'soft_landing', expectedReturn: '6.6', volatility: '9.9', maxDrawdown: '-16', returnRangeMin: '-7', returnRangeMax: '22' },
      { isin: 'IE00BL25JP73', macroScenario: 'recession', expectedReturn: '-4.9', volatility: '12.8', maxDrawdown: '-26', returnRangeMin: '-18', returnRangeMax: '16' },
      { isin: 'IE00BL25JP73', macroScenario: 'stagflation', expectedReturn: '2.9', volatility: '15.4', maxDrawdown: '-24', returnRangeMin: '-11', returnRangeMax: '18' },
      { isin: 'IE00BL25JP73', macroScenario: 'general', expectedReturn: '5.8', volatility: '10.4', maxDrawdown: '-20', returnRangeMin: '-12', returnRangeMax: '22' }
    ];
    const run = {
      runId: 'run-dup-retry',
      generatedAt: new Date(),
      seed: 42,
      pathCount: 1,
      monthCount: 2,
      assetCount: 2,
      assetOrder: ['IE00BL25JP72', 'IE00BL25JP73'],
      status: 'GENERATING',
      active: false,
      update: jest.fn().mockResolvedValue([1]),
      destroy: jest.fn().mockResolvedValue(1),
      toJSON: () => ({ ...runObjectStub })
    };
    const runObjectStub = { ...run, status: 'ACTIVE', active: true };
    run.toJSON = () => ({ ...runObjectStub });

    jest.spyOn(ETF, 'findAll').mockResolvedValue(marketUniverseEtfs);
    jest.spyOn(EtfMacroStatistics, 'findAll').mockResolvedValue(marketUniverseMacroStats);
    jest.spyOn(EtfCorrelation, 'findAll').mockResolvedValue([
      { isin1: 'IE00BL25JP72', isin2: 'IE00BL25JP73', expansion: 0.3, recession: 0.4, stagflation: 0.35, soft_landing: 0.25 }
    ]);
    jest.spyOn(StructuralProbability, 'findAll').mockResolvedValue([
      { scenario: 'expansion', probability: '0.25' },
      { scenario: 'recession', probability: '0.25' },
      { scenario: 'stagflation', probability: '0.25' },
      { scenario: 'soft_landing', probability: '0.25' }
    ]);
    jest.spyOn(TransitionMatrix, 'findAll').mockResolvedValue([
      { fromScenario: 'expansion', toScenario: 'expansion', probability: '0.6' },
      { fromScenario: 'expansion', toScenario: 'recession', probability: '0.1' },
      { fromScenario: 'expansion', toScenario: 'stagflation', probability: '0.1' },
      { fromScenario: 'expansion', toScenario: 'soft_landing', probability: '0.2' },
      { fromScenario: 'recession', toScenario: 'expansion', probability: '0.2' },
      { fromScenario: 'recession', toScenario: 'recession', probability: '0.6' },
      { fromScenario: 'recession', toScenario: 'stagflation', probability: '0.1' },
      { fromScenario: 'recession', toScenario: 'soft_landing', probability: '0.1' },
      { fromScenario: 'stagflation', toScenario: 'expansion', probability: '0.2' },
      { fromScenario: 'stagflation', toScenario: 'recession', probability: '0.1' },
      { fromScenario: 'stagflation', toScenario: 'stagflation', probability: '0.6' },
      { fromScenario: 'stagflation', toScenario: 'soft_landing', probability: '0.1' },
      { fromScenario: 'soft_landing', toScenario: 'expansion', probability: '0.2' },
      { fromScenario: 'soft_landing', toScenario: 'recession', probability: '0.1' },
      { fromScenario: 'soft_landing', toScenario: 'stagflation', probability: '0.1' },
      { fromScenario: 'soft_landing', toScenario: 'soft_landing', probability: '0.6' }
    ]);
    jest.spyOn(ScenarioInertiaConfiguration, 'findAll').mockResolvedValue([
      { scenario: 'expansion', entryProbability: '0.8', persistenceProbability: '0.9', entryMonths: 2, exitStartMonth: 6, exitDecay: '0.02' },
      { scenario: 'recession', entryProbability: '0.8', persistenceProbability: '0.9', entryMonths: 2, exitStartMonth: 6, exitDecay: '0.02' },
      { scenario: 'stagflation', entryProbability: '0.8', persistenceProbability: '0.9', entryMonths: 2, exitStartMonth: 6, exitDecay: '0.02' },
      { scenario: 'soft_landing', entryProbability: '0.8', persistenceProbability: '0.9', entryMonths: 2, exitStartMonth: 6, exitDecay: '0.02' }
    ]);
    jest.spyOn(ScenarioIntensityConfiguration, 'findAll').mockResolvedValue([
      { scenario: 'expansion', meanIntensity: '0.5', stdDevIntensity: '0.1' },
      { scenario: 'recession', meanIntensity: '0.5', stdDevIntensity: '0.1' },
      { scenario: 'stagflation', meanIntensity: '0.5', stdDevIntensity: '0.1' },
      { scenario: 'soft_landing', meanIntensity: '0.5', stdDevIntensity: '0.1' }
    ]);
    jest.spyOn(MonteCarloGlobalProperty, 'findAll').mockResolvedValue([
      { propertyKey: 'scenario_transition_intensity_threshold', value: '0.8' },
      { propertyKey: 'new_scenario_first_month_max_intensity', value: '0.9' },
      { propertyKey: 'new_scenario_second_month_max_intensity', value: '0.8' },
      { propertyKey: 'scenario_intensity_max_monthly_variation', value: '0.3' }
    ]);
    jest.spyOn(MarketUniverseRun, 'findOne').mockResolvedValue(null);
    jest.spyOn(MarketUniverseRun, 'create').mockResolvedValue(run);
    const bulkCreateMock = jest.spyOn(MarketUniverseMonth, 'bulkCreate')
      .mockRejectedValueOnce(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }))
      .mockResolvedValue([]);
    jest.spyOn(MarketUniverseMonth, 'destroy').mockResolvedValue(2);

    const payload = await MarketUniverseService.regenerateMarketUniverse({ seed: 42, pathCount: 1, monthCount: 2, assetOrder: ['IE00BL25JP72', 'IE00BL25JP73'] });

    expect(payload.success).toBe(true);
    expect(payload.rowCount).toBe(2);
    expect(bulkCreateMock).toHaveBeenCalledTimes(2);
  });

  test('creates a single active market universe run and persists month vectors', async () => {
    const marketUniverseEtfs = [
      ...fixtureEtfs,
      {
        id: 'asset-2',
        isin: 'IE00BL25JP73',
        name: 'Quality',
        nickname: 'Quality',
        ticker: 'XQQQ.MI',
        description: 'Quality ETF',
        assetClass: 'Equity',
        expense: '0.30',
        historicalData: [],
        metrics: { yield: null, volatility: null, beta: null },
        longTermExpectedReturn: '7.8',
        calibratedAt: '2024-01-01T00:00:00.000Z',
        lastCalibrationMedianCagr: '6.8'
      }
    ];
    const marketUniverseMacroStats = [
      ...fixtureMacroStats,
      { isin: 'IE00BL25JP73', macroScenario: 'expansion', expectedReturn: '7.8', volatility: '11.5', maxDrawdown: '-22', returnRangeMin: '-9', returnRangeMax: '28' },
      { isin: 'IE00BL25JP73', macroScenario: 'soft_landing', expectedReturn: '6.6', volatility: '9.9', maxDrawdown: '-16', returnRangeMin: '-7', returnRangeMax: '22' },
      { isin: 'IE00BL25JP73', macroScenario: 'recession', expectedReturn: '-4.9', volatility: '12.8', maxDrawdown: '-26', returnRangeMin: '-18', returnRangeMax: '16' },
      { isin: 'IE00BL25JP73', macroScenario: 'stagflation', expectedReturn: '2.9', volatility: '15.4', maxDrawdown: '-24', returnRangeMin: '-11', returnRangeMax: '18' },
      { isin: 'IE00BL25JP73', macroScenario: 'general', expectedReturn: '5.8', volatility: '10.4', maxDrawdown: '-20', returnRangeMin: '-12', returnRangeMax: '22' }
    ];
    const run = { runId: 'run-123', generatedAt: new Date(), seed: 42, pathCount: 1, monthCount: 2, assetCount: 2, assetOrder: ['IE00BL25JP72', 'IE00BL25JP73'], status: 'GENERATING', active: false };
    const rows = [
      { runId: 'run-123', pathId: 0, monthIndex: 0, scenario: 'expansion', intensity: 0.5, returnsVector: [0.01, 0.02] },
      { runId: 'run-123', pathId: 0, monthIndex: 1, scenario: 'recession', intensity: 0.4, returnsVector: [0.02, 0.04] }
    ];

    jest.spyOn(ETF, 'findAll').mockResolvedValue(marketUniverseEtfs);
    jest.spyOn(EtfMacroStatistics, 'findAll').mockResolvedValue(marketUniverseMacroStats);
    jest.spyOn(EtfCorrelation, 'findAll').mockResolvedValue([
      { isin1: 'IE00BL25JP72', isin2: 'IE00BL25JP73', expansion: 0.3, recession: 0.4, stagflation: 0.35, soft_landing: 0.25 }
    ]);
    jest.spyOn(StructuralProbability, 'findAll').mockResolvedValue([
      { scenario: 'expansion', probability: '0.25' },
      { scenario: 'recession', probability: '0.25' },
      { scenario: 'stagflation', probability: '0.25' },
      { scenario: 'soft_landing', probability: '0.25' }
    ]);
    jest.spyOn(TransitionMatrix, 'findAll').mockResolvedValue([
      { fromScenario: 'expansion', toScenario: 'expansion', probability: '0.6' },
      { fromScenario: 'expansion', toScenario: 'recession', probability: '0.1' },
      { fromScenario: 'expansion', toScenario: 'stagflation', probability: '0.1' },
      { fromScenario: 'expansion', toScenario: 'soft_landing', probability: '0.2' },
      { fromScenario: 'recession', toScenario: 'expansion', probability: '0.2' },
      { fromScenario: 'recession', toScenario: 'recession', probability: '0.6' },
      { fromScenario: 'recession', toScenario: 'stagflation', probability: '0.1' },
      { fromScenario: 'recession', toScenario: 'soft_landing', probability: '0.1' },
      { fromScenario: 'stagflation', toScenario: 'expansion', probability: '0.2' },
      { fromScenario: 'stagflation', toScenario: 'recession', probability: '0.1' },
      { fromScenario: 'stagflation', toScenario: 'stagflation', probability: '0.6' },
      { fromScenario: 'stagflation', toScenario: 'soft_landing', probability: '0.1' },
      { fromScenario: 'soft_landing', toScenario: 'expansion', probability: '0.2' },
      { fromScenario: 'soft_landing', toScenario: 'recession', probability: '0.1' },
      { fromScenario: 'soft_landing', toScenario: 'stagflation', probability: '0.1' },
      { fromScenario: 'soft_landing', toScenario: 'soft_landing', probability: '0.6' }
    ]);
    jest.spyOn(ScenarioInertiaConfiguration, 'findAll').mockResolvedValue([
      { scenario: 'expansion', entryProbability: '0.8', persistenceProbability: '0.9', entryMonths: 2, exitStartMonth: 6, exitDecay: '0.02' },
      { scenario: 'recession', entryProbability: '0.8', persistenceProbability: '0.9', entryMonths: 2, exitStartMonth: 6, exitDecay: '0.02' },
      { scenario: 'stagflation', entryProbability: '0.8', persistenceProbability: '0.9', entryMonths: 2, exitStartMonth: 6, exitDecay: '0.02' },
      { scenario: 'soft_landing', entryProbability: '0.8', persistenceProbability: '0.9', entryMonths: 2, exitStartMonth: 6, exitDecay: '0.02' }
    ]);
    jest.spyOn(ScenarioIntensityConfiguration, 'findAll').mockResolvedValue([
      { scenario: 'expansion', meanIntensity: '0.5', stdDevIntensity: '0.1' },
      { scenario: 'recession', meanIntensity: '0.5', stdDevIntensity: '0.1' },
      { scenario: 'stagflation', meanIntensity: '0.5', stdDevIntensity: '0.1' },
      { scenario: 'soft_landing', meanIntensity: '0.5', stdDevIntensity: '0.1' }
    ]);
    jest.spyOn(MonteCarloGlobalProperty, 'findAll').mockResolvedValue([
      { propertyKey: 'scenario_transition_intensity_threshold', value: '0.8' },
      { propertyKey: 'new_scenario_first_month_max_intensity', value: '0.9' },
      { propertyKey: 'new_scenario_second_month_max_intensity', value: '0.8' },
      { propertyKey: 'scenario_intensity_max_monthly_variation', value: '0.3' }
    ]);
    jest.spyOn(MarketUniverseRun, 'findOne').mockResolvedValue(null);
    jest.spyOn(MarketUniverseRun, 'create').mockResolvedValue(run);
    jest.spyOn(MarketUniverseMonth, 'bulkCreate').mockResolvedValue(rows);
    jest.spyOn(MarketUniverseRun, 'update').mockResolvedValue([1]);
    jest.spyOn(MarketUniverseMonth, 'destroy').mockResolvedValue(2);

    const payload = await MarketUniverseService.regenerateMarketUniverse({ seed: 42, pathCount: 1, monthCount: 2, assetOrder: ['IE00BL25JP72', 'IE00BL25JP73'] });

    expect(payload.success).toBe(true);
    expect(payload.run).toMatchObject({ runId: 'run-123', status: 'ACTIVE', active: true });
    expect(payload.rowCount).toBe(2);
  });

  test('retries final activation after transient database reset and preserves a single active run', async () => {
    await jest.unstable_mockModule('investment-lab-core', () => ({
      derivePathSeed: jest.fn(() => 1234),
      prepareMonteCarloPrecomputation: jest.fn(() => ({})),
      generateMonthlyMacroTimeline: jest.fn(() => ({ months: [{ scenario: 'expansion', intensity: 0.5 }, { scenario: 'recession', intensity: 0.4 }] })),
      generateMonthlyReturnVector: jest.fn(() => ({ etfReturns: [{ monthlyReturn: 0.01 }, { monthlyReturn: 0.02 }] })),
      SeededRandom: class MockSeededRandom {
        constructor() {}
        next() { return 0.5; }
      }
    }));
    const runtime = await import('investment-lab-core');

    const marketUniverseEtfs = [
      ...fixtureEtfs,
      {
        id: 'asset-2',
        isin: 'IE00BL25JP73',
        name: 'Quality',
        nickname: 'Quality',
        ticker: 'XQQQ.MI',
        description: 'Quality ETF',
        assetClass: 'Equity',
        expense: '0.30',
        historicalData: [],
        metrics: { yield: null, volatility: null, beta: null },
        longTermExpectedReturn: '7.8',
        calibratedAt: '2024-01-01T00:00:00.000Z',
        lastCalibrationMedianCagr: '6.8'
      }
    ];
    const marketUniverseMacroStats = [
      ...fixtureMacroStats,
      { isin: 'IE00BL25JP73', macroScenario: 'expansion', expectedReturn: '7.8', volatility: '11.5', maxDrawdown: '-22', returnRangeMin: '-9', returnRangeMax: '28' },
      { isin: 'IE00BL25JP73', macroScenario: 'soft_landing', expectedReturn: '6.6', volatility: '9.9', maxDrawdown: '-16', returnRangeMin: '-7', returnRangeMax: '22' },
      { isin: 'IE00BL25JP73', macroScenario: 'recession', expectedReturn: '-4.9', volatility: '12.8', maxDrawdown: '-26', returnRangeMin: '-18', returnRangeMax: '16' },
      { isin: 'IE00BL25JP73', macroScenario: 'stagflation', expectedReturn: '2.9', volatility: '15.4', maxDrawdown: '-24', returnRangeMin: '-11', returnRangeMax: '18' },
      { isin: 'IE00BL25JP73', macroScenario: 'general', expectedReturn: '5.8', volatility: '10.4', maxDrawdown: '-20', returnRangeMin: '-12', returnRangeMax: '22' }
    ];
    const run = {
      runId: 'run-activation-retry',
      generatedAt: new Date(),
      seed: 42,
      pathCount: 1,
      monthCount: 2,
      assetCount: 2,
      assetOrder: ['IE00BL25JP72', 'IE00BL25JP73'],
      status: 'GENERATING',
      active: false,
      update: jest.fn().mockRejectedValueOnce(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })).mockResolvedValue([1]),
      destroy: jest.fn().mockResolvedValue(1),
      toJSON: () => ({ runId: 'run-activation-retry', status: 'ACTIVE', active: true })
    };

    jest.spyOn(ETF, 'findAll').mockResolvedValue(marketUniverseEtfs);
    jest.spyOn(EtfMacroStatistics, 'findAll').mockResolvedValue(marketUniverseMacroStats);
    jest.spyOn(EtfCorrelation, 'findAll').mockResolvedValue([
      { isin1: 'IE00BL25JP72', isin2: 'IE00BL25JP73', expansion: 0.3, recession: 0.4, stagflation: 0.35, soft_landing: 0.25 }
    ]);
    jest.spyOn(StructuralProbability, 'findAll').mockResolvedValue([
      { scenario: 'expansion', probability: '0.25' },
      { scenario: 'recession', probability: '0.25' },
      { scenario: 'stagflation', probability: '0.25' },
      { scenario: 'soft_landing', probability: '0.25' }
    ]);
    jest.spyOn(TransitionMatrix, 'findAll').mockResolvedValue([
      { fromScenario: 'expansion', toScenario: 'expansion', probability: '0.6' },
      { fromScenario: 'expansion', toScenario: 'recession', probability: '0.1' },
      { fromScenario: 'expansion', toScenario: 'stagflation', probability: '0.1' },
      { fromScenario: 'expansion', toScenario: 'soft_landing', probability: '0.2' },
      { fromScenario: 'recession', toScenario: 'expansion', probability: '0.2' },
      { fromScenario: 'recession', toScenario: 'recession', probability: '0.6' },
      { fromScenario: 'recession', toScenario: 'stagflation', probability: '0.1' },
      { fromScenario: 'recession', toScenario: 'soft_landing', probability: '0.1' },
      { fromScenario: 'stagflation', toScenario: 'expansion', probability: '0.2' },
      { fromScenario: 'stagflation', toScenario: 'recession', probability: '0.1' },
      { fromScenario: 'stagflation', toScenario: 'stagflation', probability: '0.6' },
      { fromScenario: 'stagflation', toScenario: 'soft_landing', probability: '0.1' },
      { fromScenario: 'soft_landing', toScenario: 'expansion', probability: '0.2' },
      { fromScenario: 'soft_landing', toScenario: 'recession', probability: '0.1' },
      { fromScenario: 'soft_landing', toScenario: 'stagflation', probability: '0.1' },
      { fromScenario: 'soft_landing', toScenario: 'soft_landing', probability: '0.6' }
    ]);
    jest.spyOn(ScenarioInertiaConfiguration, 'findAll').mockResolvedValue([
      { scenario: 'expansion', entryProbability: '0.8', persistenceProbability: '0.9', entryMonths: 2, exitStartMonth: 6, exitDecay: '0.02' },
      { scenario: 'recession', entryProbability: '0.8', persistenceProbability: '0.9', entryMonths: 2, exitStartMonth: 6, exitDecay: '0.02' },
      { scenario: 'stagflation', entryProbability: '0.8', persistenceProbability: '0.9', entryMonths: 2, exitStartMonth: 6, exitDecay: '0.02' },
      { scenario: 'soft_landing', entryProbability: '0.8', persistenceProbability: '0.9', entryMonths: 2, exitStartMonth: 6, exitDecay: '0.02' }
    ]);
    jest.spyOn(ScenarioIntensityConfiguration, 'findAll').mockResolvedValue([
      { scenario: 'expansion', meanIntensity: '0.5', stdDevIntensity: '0.1' },
      { scenario: 'recession', meanIntensity: '0.5', stdDevIntensity: '0.1' },
      { scenario: 'stagflation', meanIntensity: '0.5', stdDevIntensity: '0.1' },
      { scenario: 'soft_landing', meanIntensity: '0.5', stdDevIntensity: '0.1' }
    ]);
    jest.spyOn(MonteCarloGlobalProperty, 'findAll').mockResolvedValue([
      { propertyKey: 'scenario_transition_intensity_threshold', value: '0.8' },
      { propertyKey: 'new_scenario_first_month_max_intensity', value: '0.9' },
      { propertyKey: 'new_scenario_second_month_max_intensity', value: '0.8' },
      { propertyKey: 'scenario_intensity_max_monthly_variation', value: '0.3' }
    ]);
    jest.spyOn(MarketUniverseRun, 'findOne').mockResolvedValue(null);
    jest.spyOn(MarketUniverseRun, 'create').mockResolvedValue(run);
    jest.spyOn(MarketUniverseMonth, 'bulkCreate').mockResolvedValue([]);
    jest.spyOn(MarketUniverseMonth, 'destroy').mockResolvedValue(2);

    const payload = await MarketUniverseService.regenerateMarketUniverse({ seed: 42, pathCount: 1, monthCount: 2, assetOrder: ['IE00BL25JP72', 'IE00BL25JP73'] });

    expect(payload.success).toBe(true);
    expect(run.update).toHaveBeenCalledTimes(3);
    expect(payload.run).toMatchObject({ runId: 'run-activation-retry', status: 'ACTIVE', active: true });
  });

  test('atomic switch executes a single transaction and only commits when the new run is active', async () => {
    const transactionSpy = jest.spyOn(sequelize, 'transaction').mockImplementation(async (options, callback) => {
      if (typeof options === 'function') {
        return options();
      }
      return callback({});
    });
    const updateSpy = jest.spyOn(MarketUniverseRun, 'update').mockResolvedValue([1]);

    await MarketUniverseService.activateReplacementRun({ runId: 'old-run', active: true }, { runId: 'new-run', active: false, status: 'READY' });

    expect(transactionSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledTimes(2);
    expect(updateSpy.mock.calls[0][0]).toMatchObject({ active: false });
    expect(updateSpy.mock.calls[1][0]).toMatchObject({ status: 'ACTIVE', active: true });
  });

  test('reconcileActiveUniverseState distinguishes committed and rolled-back switch outcomes', async () => {
    jest.spyOn(MarketUniverseRun, 'findAll').mockResolvedValueOnce([{ runId: 'old-run', status: 'ACTIVE', active: true }]).mockResolvedValueOnce([{ runId: 'new-run', status: 'ACTIVE', active: true }]);

    await expect(MarketUniverseService.reconcileActiveUniverseState('old-run', 'new-run')).resolves.toMatchObject({ outcome: 'rolled-back' });
    await expect(MarketUniverseService.reconcileActiveUniverseState('old-run', 'new-run')).resolves.toMatchObject({ outcome: 'committed' });
  });

  test('destroyOldRunSafe treats an already-deleted old run as success after an ambiguous reset', async () => {
    const previousRun = {
      runId: 'old-run',
      destroy: jest.fn().mockRejectedValue(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }))
    };

    jest.spyOn(MarketUniverseMonth, 'destroy').mockRejectedValue(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }));
    jest.spyOn(MarketUniverseRun, 'findByPk').mockResolvedValue(null);

    await expect(MarketUniverseService.destroyOldRunSafe(previousRun)).resolves.toMatchObject({
      destroyed: true,
      outcome: 'already-deleted'
    });
  });

  test('requires a durable active market universe before portfolio projection is allowed', async () => {
    jest.spyOn(MarketUniverseRun, 'findAll').mockResolvedValue([]);

    await expect(MarketUniverseService.getActiveMarketUniverseRun()).rejects.toMatchObject({
      code: 'NO_ACTIVE_MARKET_UNIVERSE'
    });
  });

  test('buildPortfolioProjectionFromActiveMarketUniverse consumes persisted monthly vectors without regenerating returns', async () => {
    const activeRun = {
      runId: 'run-active-portfolio',
      generatedAt: new Date(),
      seed: 42,
      pathCount: 2,
      monthCount: 2,
      assetCount: 2,
      assetOrder: ['IE00BL25JP72', 'IE00BL25JP73'],
      status: 'ACTIVE',
      active: true,
      toJSON: () => ({
        runId: 'run-active-portfolio',
        generatedAt: new Date().toISOString(),
        seed: 42,
        pathCount: 2,
        monthCount: 2,
        assetCount: 2,
        assetOrder: ['IE00BL25JP72', 'IE00BL25JP73'],
        status: 'ACTIVE',
        active: true
      })
    };

    const monthRows = [
      { pathId: 0, monthIndex: 0, scenario: 'expansion', intensity: 0.6, returnsVector: [0.01, -0.02] },
      { pathId: 0, monthIndex: 1, scenario: 'soft_landing', intensity: 0.5, returnsVector: [0.02, 0.01] },
      { pathId: 1, monthIndex: 0, scenario: 'recession', intensity: 0.8, returnsVector: [-0.01, 0.03] },
      { pathId: 1, monthIndex: 1, scenario: 'stagflation', intensity: 0.7, returnsVector: [0.03, -0.01] }
    ];

    jest.spyOn(MarketUniverseRun, 'findAll').mockResolvedValue([activeRun]);
    jest.spyOn(MarketUniverseMonth, 'count').mockResolvedValue(4);
    jest.spyOn(MarketUniverseMonth, 'findAll').mockResolvedValue(monthRows);

    const projection = await MarketUniverseService.buildPortfolioProjectionFromActiveMarketUniverse({
      holdings: [
        { isin: 'IE00BL25JP72', weight: 0.6 },
        { isin: 'IE00BL25JP73', weight: 0.4 }
      ]
    });

    expect(projection.run.runId).toBe('run-active-portfolio');
    expect(projection.paths).toHaveLength(2);
    expect(projection.paths[0].monthlyReturns).toHaveLength(2);
    expect(projection.paths[0].monthlyReturns[0]).toBeCloseTo(-0.002, 12);
    expect(projection.paths[0].monthlyReturns[1]).toBeCloseTo(0.016, 12);
    expect(projection.paths[1].monthlyReturns[0]).toBeCloseTo(0.006, 12);
    expect(projection.paths[1].monthlyReturns[1]).toBeCloseTo(0.014, 12);
  });
});
