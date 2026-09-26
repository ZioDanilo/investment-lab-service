const fs = require('fs');
const crypto = require('crypto');
const { performance } = require('perf_hooks');
const { Client } = require('pg');
const { spawn, execSync } = require('child_process');
const http = require('http');
require('dotenv').config({ path: './.env' });
const { MarketUniverseService } = require('./src/services/marketUniverseService');

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const sha256 = (targetPath) => crypto.createHash('sha256').update(fs.readFileSync(targetPath)).digest('hex');

const baselineFiles = [
  'C:/Progetti personali/Investimenti/investment-lab-core/src/engines/seeded-random.js',
  'C:/Progetti personali/Investimenti/investment-lab-core/src/probability/monte-carlo-probability.js',
  'C:/Progetti personali/Investimenti/investment-lab-core/src/macro/monte-carlo-macro-engine.js',
  'C:/Progetti personali/Investimenti/investment-lab-core/src/returns/monte-carlo-return-engine.js',
  'C:/Progetti personali/Investimenti/investment-lab-core/src/precomputation/monte-carlo-precomputation.js',
  'C:/Progetti personali/Investimenti/investment-lab-core/src/engines/monte-carlo-worker.js'
];

const frozenBaseline = {
  'seeded-random.js': '0860bbeb585c57bdf0686237816bca79580dfa5f7bcb5841435aa45c77d21522',
  'monte-carlo-probability.js': '6ff3337820fd44a6bfb1567cb82650c1a480f711ee03e2099ab5cdcb4c74f28e',
  'monte-carlo-macro-engine.js': 'c893c8b3e37dfebd376cdf3eb4af9596cacbea1139cf170c06f4bf3cb6dbd6c0',
  'monte-carlo-return-engine.js': 'e660674cf91a9932ac19b83f44a2e6d39277606ff0447ab0dc12ef2420bb7041',
  'monte-carlo-precomputation.js': '4433f799ffbcc9e027b974b25319ef98c57748282f9b7f66f5d845ef85185281',
  'monte-carlo-worker.js': '4e23773219c627240c6d44757a14a41f60d2258a709dc1dc4863623dd2145ce4'
};

const fileNameMap = {
  'seeded-random.js': 'C:/Progetti personali/Investimenti/investment-lab-core/src/engines/seeded-random.js',
  'monte-carlo-probability.js': 'C:/Progetti personali/Investimenti/investment-lab-core/src/probability/monte-carlo-probability.js',
  'monte-carlo-macro-engine.js': 'C:/Progetti personali/Investimenti/investment-lab-core/src/macro/monte-carlo-macro-engine.js',
  'monte-carlo-return-engine.js': 'C:/Progetti personali/Investimenti/investment-lab-core/src/returns/monte-carlo-return-engine.js',
  'monte-carlo-precomputation.js': 'C:/Progetti personali/Investimenti/investment-lab-core/src/precomputation/monte-carlo-precomputation.js',
  'monte-carlo-worker.js': 'C:/Progetti personali/Investimenti/investment-lab-core/src/engines/monte-carlo-worker.js'
};

const waitForHealth = (timeoutMs = 60000) => new Promise((resolve, reject) => {
  const started = Date.now();
  const check = () => {
    const req = http.get('http://localhost:3000/api/health', (res) => {
      res.resume();
      if (res.statusCode === 200) {
        resolve(true);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`Health check timeout after ${timeoutMs}ms`));
        return;
      }
      setTimeout(check, 1000);
    });
    req.on('error', () => {
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`Health check timeout after ${timeoutMs}ms`));
        return;
      }
      setTimeout(check, 1000);
    });
  };
  check();
});

const restartBackend = async () => {
  try {
    const netstat = execSync('netstat -ano -p tcp | findstr :3000', { encoding: 'utf8' });
    const match = netstat.match(/LISTENING\s+(\d+)/i) || netstat.match(/\s+(\d+)\s*$/m);
    if (match && match[1]) {
      execSync(`taskkill /PID ${match[1]} /F`);
    }
  } catch (error) {
    // no process on 3000; ignore
  }
  const child = spawn('node', ['src/server.js'], {
    cwd: 'C:/Progetti personali/Investimenti/investment-lab-service',
    stdio: 'ignore',
    detached: true,
    env: { ...process.env, PORT: '3000' }
  });
  child.unref();
  await waitForHealth();
  return child;
};

(async () => {
  const hashBaseline = Object.fromEntries(Object.entries(frozenBaseline).map(([name, frozen]) => [name, { frozen, current: sha256(fileNameMap[name]), identical: sha256(fileNameMap[name]) === frozen }]));
  console.log('STEP_1_BASELINE', JSON.stringify(hashBaseline, null, 2));

  const serviceDefaults = MarketUniverseService.regenerateMarketUniverse.toString();
  const defaultPathCount = Number((serviceDefaults.match(/pathCount\s*=\s*(\d+)/) || [])[1]);
  const defaultMonthCount = Number((serviceDefaults.match(/monthCount\s*=\s*(\d+)/) || [])[1]);
  assert(defaultPathCount === 1000, `Production default pathCount mismatch: ${defaultPathCount}`);
  assert(defaultMonthCount === 360, `Production default monthCount mismatch: ${defaultMonthCount}`);
  console.log('DEFAULTS', JSON.stringify({ defaultPathCount, defaultMonthCount, definedAt: 'src/services/marketUniverseService.js' }, null, 2));

  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const initialCounts = await client.query('SELECT (SELECT COUNT(*) FROM market_universe_run) AS run_rows, (SELECT COUNT(*) FROM market_universe_month) AS month_rows, (SELECT COUNT(*) FROM market_universe_run WHERE active = true) AS active_rows');
  assert(Number(initialCounts.rows[0].run_rows) === 0, `Initial run rows should be 0; actual=${initialCounts.rows[0].run_rows}`);
  assert(Number(initialCounts.rows[0].month_rows) === 0, `Initial month rows should be 0; actual=${initialCounts.rows[0].month_rows}`);
  console.log('INITIAL_DB_STATE', JSON.stringify(initialCounts.rows[0], null, 2));

  const sizeBefore = await client.query("SELECT 'market_universe_run' AS table_name, pg_relation_size('market_universe_run') AS table_bytes, pg_indexes_size('market_universe_run') AS index_bytes, pg_total_relation_size('market_universe_run') AS total_bytes UNION ALL SELECT 'market_universe_month', pg_relation_size('market_universe_month'), pg_indexes_size('market_universe_month'), pg_total_relation_size('market_universe_month');");
  console.log('INITIAL_SIZE', JSON.stringify(sizeBefore.rows, null, 2));

  const assets = await MarketUniverseService.getAllAssets();
  const orderedIsins = assets.map((asset) => String(asset.isin || '').trim()).filter(Boolean);
  assert(orderedIsins.length > 0, 'Live asset universe is empty');
  const duplicateIsinCount = orderedIsins.filter((isin, index, list) => list.indexOf(isin) !== index).length;
  const correlationRows = await client.query('SELECT isin1, isin2, expansion, soft_landing, recession, stagflation FROM etf_correlations ORDER BY isin1, isin2');
  const pairMap = new Map();
  for (const row of correlationRows.rows) {
    pairMap.set(`${row.isin1}|${row.isin2}`, row);
    pairMap.set(`${row.isin2}|${row.isin1}`, row);
  }
  const expectedPairs = orderedIsins.length * (orderedIsins.length - 1) / 2;
  const missingPairs = [];
  for (let i = 0; i < orderedIsins.length; i += 1) {
    for (let j = i + 1; j < orderedIsins.length; j += 1) {
      if (!pairMap.has(`${orderedIsins[i]}|${orderedIsins[j]}`)) {
        missingPairs.push(`${orderedIsins[i]}|${orderedIsins[j]}`);
      }
    }
  }
  let symmetryViolations = 0;
  let diagonalViolations = 0;
  for (const row of correlationRows.rows) {
    if (row.isin1 === row.isin2) {
      diagonalViolations += 1;
    }
    const reverse = pairMap.get(`${row.isin2}|${row.isin1}`);
    if (reverse) {
      for (const scenario of ['expansion', 'soft_landing', 'recession', 'stagflation']) {
        const a = Number(row[scenario]);
        const b = Number(reverse[scenario]);
        if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) > 1e-9) {
          symmetryViolations += 1;
        }
      }
    }
  }
  console.log('LIVE_UNIVERSE', JSON.stringify({ assetCount: orderedIsins.length, duplicateIsinCount, expectedPairs, actualPairs: correlationRows.rowCount, missingPairs: missingPairs.length, duplicatePairs: 0, symmetryViolations, diagonalViolations, assetOrder: orderedIsins }, null, 2));

  assert(orderedIsins.length === 15, `Unexpected live asset count: ${orderedIsins.length}`);
  assert(duplicateIsinCount === 0, `Duplicate live ISIN count: ${duplicateIsinCount}`);
  assert(correlationRows.rowCount === expectedPairs, `Correlation row count mismatch: expected ${expectedPairs}, actual ${correlationRows.rowCount}`);
  assert(missingPairs.length === 0, `Missing correlation pairs: ${missingPairs.length}`);
  assert(symmetryViolations === 0, `Correlation symmetry violations: ${symmetryViolations}`);
  assert(diagonalViolations === 0, `Diagonal correlation violations: ${diagonalViolations}`);

  const run1Start = performance.now();
  const run1 = await MarketUniverseService.regenerateMarketUniverse();
  const run1ElapsedMs = performance.now() - run1Start;
  const run1Id = run1.run.runId;
  console.log('RUN1_RESULT', JSON.stringify({ totalWallMs: Math.round(run1ElapsedMs), result: run1 }, null, 2));

  const run1Meta = await client.query('SELECT run_id, seed, path_count, month_count, asset_count, active, status, generated_at FROM market_universe_run ORDER BY generated_at DESC LIMIT 1');
  const run1Row = run1Meta.rows[0];
  assert(Number(run1Row.path_count) === 1000, `RUN_1 path_count mismatch: ${run1Row.path_count}`);
  assert(Number(run1Row.month_count) === 360, `RUN_1 month_count mismatch: ${run1Row.month_count}`);
  assert(Number(run1Row.asset_count) === orderedIsins.length, `RUN_1 asset_count mismatch: ${run1Row.asset_count}`);
  assert(run1Row.active === true, `RUN_1 not active`);
  assert(run1Row.run_id === run1Id, `RUN_1 ID mismatch`);

  const run1MonthQuery = await client.query('SELECT COUNT(*) AS month_rows, COUNT(DISTINCT path_id) AS distinct_paths, MIN(path_id) AS min_path_id, MAX(path_id) AS max_path_id, MIN(month_index) AS min_month_index, MAX(month_index) AS max_month_index FROM market_universe_month WHERE run_id = $1', [run1Id]);
  assert(Number(run1MonthQuery.rows[0].month_rows) === 360000, `RUN_1 month rows count mismatch: ${run1MonthQuery.rows[0].month_rows}`);
  assert(Number(run1MonthQuery.rows[0].distinct_paths) === 1000, `RUN_1 distinct paths mismatch: ${run1MonthQuery.rows[0].distinct_paths}`);
  assert(Number(run1MonthQuery.rows[0].min_path_id) === 0, `RUN_1 min_path_id mismatch: ${run1MonthQuery.rows[0].min_path_id}`);
  assert(Number(run1MonthQuery.rows[0].max_path_id) === 999, `RUN_1 max_path_id mismatch: ${run1MonthQuery.rows[0].max_path_id}`);
  assert(Number(run1MonthQuery.rows[0].min_month_index) === 0, `RUN_1 min_month_index mismatch: ${run1MonthQuery.rows[0].min_month_index}`);
  assert(Number(run1MonthQuery.rows[0].max_month_index) === 359, `RUN_1 max_month_index mismatch: ${run1MonthQuery.rows[0].max_month_index}`);
  console.log('RUN1_MONTH_SUMMARY', JSON.stringify(run1MonthQuery.rows[0], null, 2));

  const rowsPerPath = await client.query('SELECT path_id, COUNT(*) AS rows_per_path FROM market_universe_month WHERE run_id = $1 GROUP BY path_id ORDER BY path_id', [run1Id]);
  const minRowsPerPath = Math.min(...rowsPerPath.rows.map((row) => Number(row.rows_per_path)));
  const maxRowsPerPath = Math.max(...rowsPerPath.rows.map((row) => Number(row.rows_per_path)));
  const duplicatePathMonth = await client.query('SELECT COUNT(*) AS duplicates FROM (SELECT run_id, path_id, month_index, COUNT(*) AS c FROM market_universe_month WHERE run_id = $1 GROUP BY run_id, path_id, month_index HAVING COUNT(*) > 1) x', [run1Id]);
  const missingGrid = await client.query('SELECT (1000 * 360) - COUNT(*) AS missing_combination_count FROM market_universe_month WHERE run_id = $1', [run1Id]);
  assert(minRowsPerPath === 360, `RUN_1 min rows per path mismatch: ${minRowsPerPath}`);
  assert(maxRowsPerPath === 360, `RUN_1 max rows per path mismatch: ${maxRowsPerPath}`);
  assert(Number(duplicatePathMonth.rows[0].duplicates) === 0, `RUN_1 duplicate path/month count mismatch: ${duplicatePathMonth.rows[0].duplicates}`);
  assert(Number(missingGrid.rows[0].missing_combination_count) === 0, `RUN_1 missing grid combinations: ${missingGrid.rows[0].missing_combination_count}`);
  console.log('RUN1_GRID_VALIDATION', JSON.stringify({ minRowsPerPath, maxRowsPerPath, duplicatePathMonth: Number(duplicatePathMonth.rows[0].duplicates), missingCombinations: Number(missingGrid.rows[0].missing_combination_count) }, null, 2));

  const vectorStats = await client.query('SELECT COUNT(*) FILTER (WHERE returns_vector IS NULL) AS null_vectors, MIN(array_length(returns_vector, 1)) AS min_vector_len, MAX(array_length(returns_vector, 1)) AS max_vector_len, COUNT(*) FILTER (WHERE array_length(returns_vector, 1) <> $2) AS bad_vector_length, COUNT(*) FILTER (WHERE returns_vector IS NULL OR EXISTS (SELECT 1 FROM unnest(returns_vector) AS val WHERE val IS NULL)) AS null_return_elements, COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM unnest(returns_vector) AS val WHERE val::text IN (\'NaN\', \'Infinity\', \'-Infinity\')) ) AS non_finite_returns, COUNT(*) FILTER (WHERE scenario IS NULL OR scenario = \'\') AS null_scenario_rows, COUNT(*) FILTER (WHERE intensity IS NULL OR NOT (intensity = intensity)::bool) AS null_or_invalid_intensity, COUNT(*) FILTER (WHERE intensity::text IN (\'NaN\', \'Infinity\', \'-Infinity\')) AS non_finite_intensity FROM market_universe_month WHERE run_id = $1', [run1Id, orderedIsins.length]);
  const logicalReturnCount = await client.query('SELECT COUNT(*)::int AS logical_return_count FROM (SELECT unnest(returns_vector) FROM market_universe_month WHERE run_id = $1) s', [run1Id]);
  assert(Number(vectorStats.rows[0].null_vectors) === 0, `RUN_1 null vector count mismatch: ${vectorStats.rows[0].null_vectors}`);
  assert(Number(vectorStats.rows[0].min_vector_len) === orderedIsins.length, `RUN_1 min vector length mismatch: ${vectorStats.rows[0].min_vector_len}`);
  assert(Number(vectorStats.rows[0].max_vector_len) === orderedIsins.length, `RUN_1 max vector length mismatch: ${vectorStats.rows[0].max_vector_len}`);
  assert(Number(vectorStats.rows[0].bad_vector_length) === 0, `RUN_1 bad vector length mismatch: ${vectorStats.rows[0].bad_vector_length}`);
  assert(Number(vectorStats.rows[0].null_return_elements) === 0, `RUN_1 null return elements mismatch: ${vectorStats.rows[0].null_return_elements}`);
  assert(Number(vectorStats.rows[0].non_finite_returns) === 0, `RUN_1 non-finite returns mismatch: ${vectorStats.rows[0].non_finite_returns}`);
  assert(Number(vectorStats.rows[0].null_scenario_rows) === 0, `RUN_1 null scenario rows mismatch: ${vectorStats.rows[0].null_scenario_rows}`);
  assert(Number(vectorStats.rows[0].null_or_invalid_intensity) === 0, `RUN_1 intensity validity mismatch: ${vectorStats.rows[0].null_or_invalid_intensity}`);
  assert(Number(vectorStats.rows[0].non_finite_intensity) === 0, `RUN_1 non-finite intensity mismatch: ${vectorStats.rows[0].non_finite_intensity}`);
  assert(Number(logicalReturnCount.rows[0].logical_return_count) === 18000000, `RUN_1 logical return count mismatch: ${logicalReturnCount.rows[0].logical_return_count}`);
  console.log('RUN1_VECTOR_INTEGRITY', JSON.stringify({ vectorStats: vectorStats.rows[0], logicalReturnCount: Number(logicalReturnCount.rows[0].logical_return_count) }, null, 2));

  const sampleRows = await client.query('SELECT path_id, month_index, scenario, intensity, array_length(returns_vector,1) AS vector_length, returns_vector[1:3] AS first_three FROM market_universe_month WHERE run_id = $1 AND ((path_id = 0 AND month_index IN (0,1199)) OR (path_id = 1 AND month_index = 0) OR (path_id = 499 AND month_index = 600) OR (path_id = 999 AND month_index IN (0,1199))) ORDER BY path_id, month_index', [run1Id]);
  console.log('RUN1_SAMPLE_ROWS', JSON.stringify(sampleRows.rows, null, 2));

  const scenarioCounts = await client.query('SELECT scenario, COUNT(*) AS rows FROM market_universe_month WHERE run_id = $1 GROUP BY scenario ORDER BY scenario', [run1Id]);
  const intensityStats = await client.query('SELECT scenario, MIN(intensity) AS min_intensity, MAX(intensity) AS max_intensity, AVG(intensity) AS avg_intensity FROM market_universe_month WHERE run_id = $1 GROUP BY scenario ORDER BY scenario', [run1Id]);
  console.log('RUN1_SCENARIO_SUMMARY', JSON.stringify({ scenarioCounts: scenarioCounts.rows, intensityStats: intensityStats.rows }, null, 2));

  const sizeAfterRun1 = await client.query("SELECT 'market_universe_run' AS table_name, pg_relation_size('market_universe_run') AS table_bytes, pg_indexes_size('market_universe_run') AS index_bytes, pg_total_relation_size('market_universe_run') AS total_bytes UNION ALL SELECT 'market_universe_month', pg_relation_size('market_universe_month'), pg_indexes_size('market_universe_month'), pg_total_relation_size('market_universe_month');");
  console.log('RUN1_SIZE', JSON.stringify(sizeAfterRun1.rows, null, 2));

  const hashAfterRun1 = Object.fromEntries(Object.entries(frozenBaseline).map(([name, frozen]) => [name, { frozen, current: sha256(fileNameMap[name]), identical: sha256(fileNameMap[name]) === frozen }]));
  console.log('RUN1_HASH_CHECK', JSON.stringify(hashAfterRun1, null, 2));
  for (const [name, value] of Object.entries(hashAfterRun1)) {
    assert(value.identical === true, `Hash changed after RUN_1: ${name} ${value.current} vs ${value.frozen}`);
  }

  await restartBackend();
  const healthAfterRestart = await client.query('SELECT 1');
  console.log('RESTART_HEALTH', JSON.stringify({ health: 'OK', dbCheck: healthAfterRestart.rowCount }, null, 2));

  const activeAfterRestart = await client.query('SELECT run_id, active, status FROM market_universe_run WHERE active = true');
  assert(activeAfterRestart.rowCount === 1, `Active runs after restart expected 1, actual ${activeAfterRestart.rowCount}`);
  assert(activeAfterRestart.rows[0].run_id === run1Id, `Active run after restart mismatch: expected ${run1Id}, actual ${activeAfterRestart.rows[0].run_id}`);
  const monthRowsAfterRestart = await client.query('SELECT COUNT(*) AS month_rows FROM market_universe_month WHERE run_id = $1', [run1Id]);
  assert(Number(monthRowsAfterRestart.rows[0].month_rows) === 360000, `After restart RUN_1 month rows mismatch: ${monthRowsAfterRestart.rows[0].month_rows}`);
  console.log('RESTART_PERSISTENCE_CHECK', JSON.stringify({ activeRun: activeAfterRestart.rows[0], monthRows: Number(monthRowsAfterRestart.rows[0].month_rows) }, null, 2));

  const run2Start = performance.now();
  const run2 = await MarketUniverseService.regenerateMarketUniverse();
  const run2ElapsedMs = performance.now() - run2Start;
  const run2Id = run2.run.runId;
  console.log('RUN2_RESULT', JSON.stringify({ totalWallMs: Math.round(run2ElapsedMs), runId: run2Id, generatedAt: run2.run.generatedAt }, null, 2));
  assert(run2Id !== run1Id, `RUN_2 should differ from RUN_1: ${run2Id} === ${run1Id}`);

  const postRun2Counts = await client.query('SELECT (SELECT COUNT(*) FROM market_universe_run) AS total_runs, (SELECT COUNT(*) FROM market_universe_run WHERE active = true) AS active_runs, (SELECT COUNT(*) FROM market_universe_month) AS total_month_rows, (SELECT COUNT(*) FROM market_universe_month WHERE run_id = $1) AS run2_month_rows, (SELECT COUNT(*) FROM market_universe_run WHERE run_id = $2) AS run1_present', [run2Id, run1Id]);
  assert(Number(postRun2Counts.rows[0].total_runs) === 1, `RUN_2 final total run rows mismatch: ${postRun2Counts.rows[0].total_runs}`);
  assert(Number(postRun2Counts.rows[0].active_runs) === 1, `RUN_2 active rows mismatch: ${postRun2Counts.rows[0].active_runs}`);
  assert(Number(postRun2Counts.rows[0].total_month_rows) === 360000, `RUN_2 total month rows mismatch: ${postRun2Counts.rows[0].total_month_rows}`);
  assert(Number(postRun2Counts.rows[0].run2_month_rows) === 360000, `RUN_2 month rows mismatch: ${postRun2Counts.rows[0].run2_month_rows}`);
  assert(Number(postRun2Counts.rows[0].run1_present) === 0, `RUN_1 was not deleted after RUN_2 activation`);
  console.log('RUN2_FINAL_COUNTS', JSON.stringify(postRun2Counts.rows[0], null, 2));

  const run2Summary = await client.query('SELECT COUNT(*) AS month_rows, COUNT(DISTINCT path_id) AS distinct_paths, MIN(path_id) AS min_path_id, MAX(path_id) AS max_path_id, MIN(month_index) AS min_month_index, MAX(month_index) AS max_month_index FROM market_universe_month WHERE run_id = $1', [run2Id]);
  console.log('RUN2_MONTH_SUMMARY', JSON.stringify(run2Summary.rows[0], null, 2));

  const run2Grid = await client.query('SELECT path_id, COUNT(*) AS rows_per_path FROM market_universe_month WHERE run_id = $1 GROUP BY path_id ORDER BY path_id', [run2Id]);
  const run2Min = Math.min(...run2Grid.rows.map((row) => Number(row.rows_per_path)));
  const run2Max = Math.max(...run2Grid.rows.map((row) => Number(row.rows_per_path)));
  assert(run2Min === 360 && run2Max === 360, `RUN_2 rows per path range mismatch: ${run2Min}..${run2Max}`);

  const run2Samples = await client.query('SELECT path_id, month_index, scenario, intensity, array_length(returns_vector,1) AS vector_length, returns_vector[1:3] AS first_three FROM market_universe_month WHERE run_id = $1 AND ((path_id = 0 AND month_index IN (0,1199)) OR (path_id = 499 AND month_index = 600) OR (path_id = 999 AND month_index IN (0,1199))) ORDER BY path_id, month_index', [run2Id]);
  console.log('RUN2_SAMPLE_ROWS', JSON.stringify(run2Samples.rows, null, 2));

  const finalHashCheck = Object.fromEntries(Object.entries(frozenBaseline).map(([name, frozen]) => [name, { frozen, current: sha256(fileNameMap[name]), identical: sha256(fileNameMap[name]) === frozen }]));
  console.log('FINAL_HASH_CHECK', JSON.stringify(finalHashCheck, null, 2));
  for (const [name, value] of Object.entries(finalHashCheck)) {
    assert(value.identical === true, `Quantitative hash changed at end: ${name}`);
  }

  console.log('ALL_CERTIFICATION_CHECKS_PASSED');
  await client.end();
})().catch((error) => {
  console.error('CERTIFICATION_FAILED');
  console.error(error.stack || error.message);
  process.exit(1);
});
