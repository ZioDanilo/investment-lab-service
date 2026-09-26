require('dotenv').config({ path: './.env' });
const fs = require('fs');
const crypto = require('crypto');
const { Client } = require('pg');
const ETF = require('./src/models/ETF');
const EtfMacroStatistics = require('./src/models/EtfMacroStatistics');

ETF.hasMany(EtfMacroStatistics, { foreignKey: 'isin', sourceKey: 'isin', as: 'macroStats' });
EtfMacroStatistics.belongsTo(ETF, { foreignKey: 'isin', targetKey: 'isin' });

const { MarketUniverseService } = require('./src/services/marketUniverseService');

const baseline = {
  'seeded-random.js': '0860bbeb585c57bdf0686237816bca79580dfa5f7bcb5841435aa45c77d21522',
  'monte-carlo-probability.js': '6ff3337820fd44a6bfb1567cb82650c1a480f711ee03e2099ab5cdcb4c74f28e',
  'monte-carlo-macro-engine.js': 'c893c8b3e37dfebd376cdf3eb4af9596cacbea1139cf170c06f4bf3cb6dbd6c0',
  'monte-carlo-return-engine.js': 'e660674cf91a9932ac19b83f44a2e6d39277606ff0447ab0dc12ef2420bb7041',
  'monte-carlo-precomputation.js': '4433f799ffbcc9e027b974b25319ef98c57748282f9b7f66f5d845ef85185281',
  'monte-carlo-worker.js': '4e23773219c627240c6d44757a14a41f60d2258a709dc1dc4863623dd2145ce4'
};

const fileMap = {
  'seeded-random.js': 'C:/Progetti personali/Investimenti/investment-lab-core/src/engines/seeded-random.js',
  'monte-carlo-probability.js': 'C:/Progetti personali/Investimenti/investment-lab-core/src/probability/monte-carlo-probability.js',
  'monte-carlo-macro-engine.js': 'C:/Progetti personali/Investimenti/investment-lab-core/src/macro/monte-carlo-macro-engine.js',
  'monte-carlo-return-engine.js': 'C:/Progetti personali/Investimenti/investment-lab-core/src/returns/monte-carlo-return-engine.js',
  'monte-carlo-precomputation.js': 'C:/Progetti personali/Investimenti/investment-lab-core/src/precomputation/monte-carlo-precomputation.js',
  'monte-carlo-worker.js': 'C:/Progetti personali/Investimenti/investment-lab-core/src/engines/monte-carlo-worker.js'
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const hashReport = Object.fromEntries(Object.entries(baseline).map(([file, frozen]) => {
  const digest = crypto.createHash('sha256').update(fs.readFileSync(fileMap[file])).digest('hex');
  return [file, { frozen, current: digest, identical: digest === frozen }];
}));

(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();

  const initialCounts = await client.query('SELECT (SELECT COUNT(*) FROM market_universe_run) AS run_rows, (SELECT COUNT(*) FROM market_universe_month) AS month_rows, (SELECT COUNT(*) FROM market_universe_run WHERE active = true) AS active_rows');
  const initial = initialCounts.rows[0];
  assert(initial.run_rows === '0' && initial.month_rows === '0', `DB not clean before smoke: ${JSON.stringify(initial)}`);

  const assets = await MarketUniverseService.getAllAssets();
  const assetOrder = assets.map((asset) => String(asset.isin || '').trim()).filter(Boolean);
  const duplicateIsinCount = assetOrder.filter((isin, index, list) => list.indexOf(isin) !== index).length;
  const requiredScenarios = ['general', 'expansion', 'soft_landing', 'recession', 'stagflation'];
  const missingMacroStatistics = assets.filter((asset) => requiredScenarios.some((scenario) => !asset[scenario] || typeof asset[scenario] !== 'object')).length;
  const missingRequiredScenarioStats = assets.filter((asset) => requiredScenarios.some((scenario) => {
    const stats = asset[scenario];
    return !stats || !Number.isFinite(Number(stats.expectedReturn)) || !Number.isFinite(Number(stats.volatility)) || !Number.isFinite(Number(stats.returnRange && stats.returnRange.min)) || !Number.isFinite(Number(stats.returnRange && stats.returnRange.max));
  })).length;
  const invalidQuantitativeValues = assets.filter((asset) => [asset.expectedReturn, asset.volatility, asset.maxDrawdown, asset.returnRangeMin, asset.returnRangeMax].some((value) => value !== null && value !== undefined && !Number.isFinite(Number(value)))).length;

  assert(assetOrder.length > 0, 'asset count is zero');
  assert(duplicateIsinCount === 0, `duplicate ISIN count is ${duplicateIsinCount}`);
  assert(missingMacroStatistics === 0, `missing macro statistics: ${missingMacroStatistics}`);
  assert(missingRequiredScenarioStats === 0, `missing required scenario stats: ${missingRequiredScenarioStats}`);
  assert(invalidQuantitativeValues === 0, `invalid quantitative values: ${invalidQuantitativeValues}`);

  const correlationRows = await client.query('SELECT isin1, isin2, expansion, recession, stagflation, soft_landing FROM etf_correlations ORDER BY isin1, isin2');
  const pairMap = new Map();
  for (const row of correlationRows.rows) {
    pairMap.set(`${row.isin1}|${row.isin2}`, row);
    pairMap.set(`${row.isin2}|${row.isin1}`, row);
  }
  const expectedPairs = (assetOrder.length * (assetOrder.length - 1)) / 2;
  const missingPairs = [];
  for (let i = 0; i < assetOrder.length; i += 1) {
    for (let j = i + 1; j < assetOrder.length; j += 1) {
      if (!pairMap.has(`${assetOrder[i]}|${assetOrder[j]}`)) {
        missingPairs.push(`${assetOrder[i]}|${assetOrder[j]}`);
      }
    }
  }
  const nonFiniteCorrelationValues = correlationRows.rows.filter((row) => ['expansion', 'soft_landing', 'recession', 'stagflation'].some((scenario) => !Number.isFinite(Number(row[scenario])))).length;
  const symmetryViolations = [];
  for (const row of correlationRows.rows) {
    const reverse = pairMap.get(`${row.isin2}|${row.isin1}`);
    if (!reverse) continue;
    for (const scenario of ['expansion', 'soft_landing', 'recession', 'stagflation']) {
      const a = Number(row[scenario]);
      const b = Number(reverse[scenario]);
      if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) > 1e-9) {
        symmetryViolations.push({ isin1: row.isin1, isin2: row.isin2, scenario, a, b });
      }
    }
  }
  const diagonalViolations = correlationRows.rows.filter((row) => row.isin1 === row.isin2).length;
  assert(missingPairs.length === 0, `missing correlation pairs: ${missingPairs.length}`);
  assert(nonFiniteCorrelationValues === 0, `non-finite correlation values: ${nonFiniteCorrelationValues}`);
  assert(symmetryViolations.length === 0, `symmetry violations: ${symmetryViolations.length}`);
  assert(diagonalViolations === 0, `diagonal correlation violations: ${diagonalViolations}`);

  const smoke = await MarketUniverseService.regenerateMarketUniverse({ seed: 42, pathCount: 2, monthCount: 12 });
  const runRow = (await client.query('SELECT run_id, seed, path_count, month_count, asset_count, asset_order, active FROM market_universe_run ORDER BY generated_at DESC LIMIT 1')).rows[0];
  assert(runRow, 'no run record created');
  assert(Number(runRow.path_count) === 2, `run path_count mismatch: ${runRow.path_count}`);
  assert(Number(runRow.month_count) === 12, `run month_count mismatch: ${runRow.month_count}`);
  assert(Number(runRow.asset_count) === assetOrder.length, `run asset_count mismatch: ${runRow.asset_count} vs ${assetOrder.length}`);
  assert(runRow.asset_order.length === assetOrder.length, `asset_order length mismatch ${runRow.asset_order.length} vs ${assetOrder.length}`);

  const monthRows = await client.query('SELECT run_id, path_id, month_index, scenario, intensity, array_length(returns_vector, 1) AS vector_length, returns_vector FROM market_universe_month WHERE run_id = $1 ORDER BY path_id, month_index', [runRow.run_id]);
  assert(monthRows.rowCount === 24, `month row count mismatch: ${monthRows.rowCount}`);

  const pathIds = monthRows.rows.map((row) => Number(row.path_id));
  const monthIndexes = monthRows.rows.map((row) => Number(row.month_index));
  const rowsPerPath = {};
  for (const row of monthRows.rows) {
    rowsPerPath[row.path_id] = (rowsPerPath[row.path_id] || 0) + 1;
  }
  const distinctPaths = new Set(pathIds).size;
  assert(distinctPaths === 2, `distinct path count mismatch: ${distinctPaths}`);
  assert(Math.min(...pathIds) === 0 && Math.max(...pathIds) === 1, `path id range mismatch: ${Math.min(...pathIds)}..${Math.max(...pathIds)}`);
  assert(Math.min(...monthIndexes) === 0 && Math.max(...monthIndexes) === 11, `month index range mismatch: ${Math.min(...monthIndexes)}..${Math.max(...monthIndexes)}`);
  assert(Object.values(rowsPerPath).every((value) => value === 12), `rows per path invalid: ${JSON.stringify(rowsPerPath)}`);

  const vectorLengths = monthRows.rows.map((row) => Array.isArray(row.returns_vector) ? row.returns_vector.length : 0);
  const vectorMin = Math.min(...vectorLengths);
  const vectorMax = Math.max(...vectorLengths);
  const nullVectors = monthRows.rows.filter((row) => row.returns_vector == null).length;
  const nullReturnElements = monthRows.rows.filter((row) => Array.isArray(row.returns_vector) && row.returns_vector.some((value) => value === null || value === undefined)).length;
  const nonFiniteReturns = monthRows.rows.filter((row) => Array.isArray(row.returns_vector) && row.returns_vector.some((value) => !Number.isFinite(Number(value)))).length;
  const nullScenarios = monthRows.rows.filter((row) => row.scenario == null || row.scenario === '').length;
  const nonFiniteIntensities = monthRows.rows.filter((row) => !Number.isFinite(Number(row.intensity))).length;

  assert(vectorMin === assetOrder.length && vectorMax === assetOrder.length, `vector lengths mismatch: ${vectorMin}..${vectorMax}`);
  assert(nullVectors === 0, `null vector count: ${nullVectors}`);
  assert(nullReturnElements === 0, `null return elements: ${nullReturnElements}`);
  assert(nonFiniteReturns === 0, `non-finite returns: ${nonFiniteReturns}`);
  assert(nullScenarios === 0, `null scenarios: ${nullScenarios}`);
  assert(nonFiniteIntensities === 0, `non-finite intensities: ${nonFiniteIntensities}`);

  const activeCount = (await client.query('SELECT COUNT(*) AS active_count FROM market_universe_run WHERE active = true')).rows[0].active_count;
  assert(Number(activeCount) <= 1, `more than one active run: ${activeCount}`);

  const sampleSelection = [
    { path: 0, month: 0 },
    { path: 0, month: 11 },
    { path: 1, month: 0 },
    { path: 1, month: 11 }
  ];
  const sampleRows = sampleSelection.map((sample) => {
    const row = monthRows.rows.find((entry) => Number(entry.path_id) === sample.path && Number(entry.month_index) === sample.month);
    assert(row, `sample missing for ${sample.path}/${sample.month}`);
    return {
      ...sample,
      scenario: row.scenario,
      intensity: row.intensity,
      vectorLength: row.vector_length,
      firstThree: row.returns_vector.slice(0, 3)
    };
  });

  await client.query('DELETE FROM market_universe_run WHERE run_id = $1', [runRow.run_id]);
  const afterDelete = await client.query('SELECT (SELECT COUNT(*) FROM market_universe_run WHERE run_id = $1) AS run_rows, (SELECT COUNT(*) FROM market_universe_month WHERE run_id = $1) AS month_rows', [runRow.run_id]);
  assert(Number(afterDelete.rows[0].run_rows) === 0, `run rows not removed: ${afterDelete.rows[0].run_rows}`);
  assert(Number(afterDelete.rows[0].month_rows) === 0, `month rows not removed: ${afterDelete.rows[0].month_rows}`);

  const finalCounts = await client.query('SELECT (SELECT COUNT(*) FROM market_universe_run) AS run_rows, (SELECT COUNT(*) FROM market_universe_month) AS month_rows');
  assert(Number(finalCounts.rows[0].run_rows) === 0, `final run rows: ${finalCounts.rows[0].run_rows}`);
  assert(Number(finalCounts.rows[0].month_rows) === 0, `final month rows: ${finalCounts.rows[0].month_rows}`);

  const finalHashStatus = Object.fromEntries(Object.entries(baseline).map(([file, frozen]) => {
    const digest = crypto.createHash('sha256').update(fs.readFileSync(fileMap[file])).digest('hex');
    return [file, { frozen, current: digest, identical: digest === frozen }];
  }));

  console.log(JSON.stringify({
    hashReport,
    finalHashStatus,
    initialCounts: initial,
    assetCount: assetOrder.length,
    assetOrder: assetOrder.slice(0, 20),
    missingMacroStatistics,
    missingRequiredScenarioStats,
    invalidQuantitativeValues,
    correlationSummary: {
      expectedPairs,
      actualPairs: correlationRows.rowCount,
      missingPairs: missingPairs.length,
      nonFiniteCorrelationValues,
      symmetryViolations: symmetryViolations.length,
      diagonalViolations
    },
    smokeRun: {
      runId: runRow.run_id,
      pathCount: Number(runRow.path_count),
      monthCount: Number(runRow.month_count),
      assetCount: Number(runRow.asset_count),
      active: runRow.active,
      rowCount: monthRows.rowCount,
      distinctPaths,
      rowsPerPath,
      minVectorLength: vectorMin,
      maxVectorLength: vectorMax,
      nullVectors,
      nullReturnElements,
      nonFiniteReturns,
      nullScenarios,
      nonFiniteIntensities
    },
    sampleRows,
    finalCounts: finalCounts.rows[0]
  }, null, 2));

  await client.end();
})();
