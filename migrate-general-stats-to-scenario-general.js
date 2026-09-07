require('dotenv').config();
const { connectDB, sequelize } = require('./src/config/database');
const ETF = require('./src/models/ETF');
const EtfMacroStatistics = require('./src/models/EtfMacroStatistics');

const GENERAL_SCENARIO = 'general';
const CORE_SCENARIOS = ['expansion', 'soft_landing', 'recession', 'stagflation'];

const toNumber = (value) => {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const deriveGeneralFallback = (rows) => {
  const scenarios = rows.filter((row) => CORE_SCENARIOS.includes(row.macroScenario));
  if (scenarios.length === 0) return null;

  const avg = (selector) => {
    const values = scenarios
      .map(selector)
      .map(toNumber)
      .filter((v) => v !== null);
    if (values.length === 0) return null;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  };

  return {
    expectedReturn: avg((r) => r.expectedReturn),
    volatility: avg((r) => r.volatility),
    maxDrawdown: avg((r) => r.maxDrawdown),
    returnRangeMin: avg((r) => r.returnRangeMin),
    returnRangeMax: avg((r) => r.returnRangeMax)
  };
};

(async () => {
  try {
    await connectDB();
    console.log('\nStarting migration of general long-term stats to etf_macro_statistics (scenario=general)\n');

    const etfs = await ETF.findAll({
      attributes: ['isin', 'name', 'longTermExpectedReturn']
    });

    console.log(`ETFs in anagrafica_etf: ${etfs.length}`);

    let migrated = 0;
    let skipped = 0;

    for (const etf of etfs) {
      const isin = etf.isin;
      const rows = await EtfMacroStatistics.findAll({ where: { isin } });
      const existingGeneral = rows.find((row) => row.macroScenario === GENERAL_SCENARIO) || null;
      const fallback = deriveGeneralFallback(rows);

      const legacyLongTerm = toNumber(etf.longTermExpectedReturn);
      const expectedReturnPct =
        (legacyLongTerm !== null ? legacyLongTerm * 100 : null) ??
        toNumber(existingGeneral?.expectedReturn) ??
        fallback?.expectedReturn ??
        null;

      const volatility = toNumber(existingGeneral?.volatility) ?? fallback?.volatility;
      const maxDrawdown = toNumber(existingGeneral?.maxDrawdown) ?? fallback?.maxDrawdown;
      const returnRangeMin = toNumber(existingGeneral?.returnRangeMin) ?? fallback?.returnRangeMin;
      const returnRangeMax = toNumber(existingGeneral?.returnRangeMax) ?? fallback?.returnRangeMax;

      if ([expectedReturnPct, volatility, maxDrawdown, returnRangeMin, returnRangeMax].some((v) => v === null)) {
        skipped++;
        console.log(`SKIP ${isin}: missing scenario baseline to build general row`);
        continue;
      }

      if (existingGeneral && legacyLongTerm === null) {
        // Already normalized and no legacy source to override.
        continue;
      }

      await EtfMacroStatistics.upsert({
        isin,
        macroScenario: GENERAL_SCENARIO,
        expectedReturn: expectedReturnPct,
        volatility,
        maxDrawdown,
        returnRangeMin,
        returnRangeMax
      });

      migrated++;
      console.log(`OK   ${isin}: general expectedReturn=${expectedReturnPct.toFixed(4)}%`);
    }

    const totalGeneralRows = await EtfMacroStatistics.count({ where: { macroScenario: GENERAL_SCENARIO } });

    console.log('\nMigration completed');
    console.log(`Migrated: ${migrated}`);
    console.log(`Skipped : ${skipped}`);
    console.log(`Total scenario=general rows in DB: ${totalGeneralRows}\n`);

    await sequelize.close();
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error.message);
    await sequelize.close();
    process.exit(1);
  }
})();
