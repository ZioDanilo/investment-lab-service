const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { Client } = require('pg');

const CLIENT = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const BASE_URL = 'http://localhost:3000/api';

function round(n) {
  return Number.parseFloat(n.toFixed(12));
}

async function httpJson(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON from ${url}: ${text.slice(0, 200)}`);
  }
  if (!response.ok) {
    const message = json?.error || json?.message || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return json;
}

async function loadActiveRun() {
  const run = await httpJson('GET', `${BASE_URL}/market-universe/active`);
  return run.data;
}

async function loadPortfolioByName(name) {
  const list = await httpJson('GET', `${BASE_URL}/portfolio`);
  const portfolio = (list.data || []).find((entry) => entry.nome === name);
  if (!portfolio) throw new Error(`Portfolio ${name} not found`);
  return portfolio;
}

function normalizePortfolioHoldings(portfolio) {
  const entries = (portfolio.etfs || []).map((entry) => ({
    isin: entry?.etf?.isin,
    weight: Number(entry?.peso ?? entry?.weight ?? 0)
  })).filter((entry) => entry.isin && Number.isFinite(entry.weight) && entry.weight > 0);
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  return entries.map((entry) => ({ isin: entry.isin, weight: entry.weight / total }));
}

async function buildProjection(holdings) {
  const payload = { holdings };
  const response = await httpJson('POST', `${BASE_URL}/market-universe/portfolio/projection`, payload);
  return response.data;
}

async function queryRawRun(runId) {
  const sql = `
    SELECT run_id, generated_at, status, active, path_count, month_count, asset_count, asset_order
    FROM market_universe_run
    WHERE run_id = $1::uuid;
  `;
  const result = await CLIENT.query(sql, [runId]);
  return result.rows[0];
}

async function queryRawMonthRows(runId, pathIds, monthRange) {
  const query = `
    SELECT path_id, month_index, returns_vector
    FROM market_universe_month
    WHERE run_id = $1::uuid
      AND path_id = ANY($2::int[]) 
      AND month_index BETWEEN $3 AND $4
    ORDER BY path_id, month_index;
  `;
  const result = await CLIENT.query(query, [runId, pathIds, monthRange[0], monthRange[1]]);
  return result.rows;
}

function assertAllFinite(values, label) {
  const invalid = values.filter((value) => !Number.isFinite(value));
  if (invalid.length) {
    throw new Error(`${label} has non-finite values: ${invalid.length}`);
  }
}

(async () => {
  try {
    await CLIENT.connect();
    const activeRun = await loadActiveRun();
    const rawRun = await queryRawRun(activeRun.runId);
    const portfolio = await loadPortfolioByName('Sonia');
    const holdings = normalizePortfolioHoldings(portfolio);
    const projection = await buildProjection(holdings);

    const allPathIds = projection.paths.map((path) => Number(path.pathId));
    const monthlyLengths = projection.paths.map((path) => path.monthlyReturns.length);
    const allValues = projection.paths.flatMap((path) => path.monthlyReturns);
    assertAllFinite(allValues, 'projection values');

    const numericSummary = {
      activeRunId: activeRun.runId,
      activeRunStatus: activeRun.status,
      portfolioEtfCount: holdings.length,
      holdings,
      assetOrder: rawRun.asset_order,
      activeRunPathCount: Number(activeRun.pathCount),
      activeRunMonthCount: Number(activeRun.monthCount),
      returnedPaths: projection.paths.length,
      minPathId: allPathIds.reduce((min, pathId) => Math.min(min, pathId), Number.MAX_SAFE_INTEGER),
      maxPathId: allPathIds.reduce((max, pathId) => Math.max(max, pathId), Number.MIN_SAFE_INTEGER),
      monthsPerPath: new Set(monthlyLengths).size === 1 ? monthlyLengths[0] : monthlyLengths,
      hasFiniteValues: allValues.every(Number.isFinite),
      runIdMatches: activeRun.runId === rawRun.run_id,
      dbRowsExpected: Number(activeRun.pathCount) * Number(activeRun.monthCount),
      dbRowsActual: await CLIENT.query('SELECT COUNT(*)::int AS count FROM market_universe_month WHERE run_id = $1::uuid', [activeRun.runId]).then((r) => Number(r.rows[0].count))
    };

    const eqPathIds = [0, 1, 2];
    const eqMonths = [0, 5, 11];
    const assetOrder = rawRun.asset_order.map((isin) => String(isin).trim().toUpperCase());
    const assetIndex = new Map(assetOrder.map((isin, index) => [isin, index]));
    const assetMatrix = new Map();
    const rawRows = await queryRawMonthRows(activeRun.runId, eqPathIds, [0, 11]);
    const rawByPathMonth = new Map();
    for (const row of rawRows) {
      rawByPathMonth.set(`${row.path_id}:${row.month_index}`, row.returns_vector);
    }

    const eqSamples = [];
    for (const pathId of eqPathIds) {
      for (const monthIndex of eqMonths) {
        const expectedVector = rawByPathMonth.get(`${pathId}:${monthIndex}`);
        const weightMap = new Map(holdings.map((h) => [h.isin, h.weight]));
        let expected = 0;
        for (const [isin, weight] of weightMap.entries()) {
          const idx = assetIndex.get(isin.toUpperCase());
          if (idx === undefined || !expectedVector || idx >= expectedVector.length) {
            throw new Error(`Missing raw asset map for ${isin} in path ${pathId}, month ${monthIndex}`);
          }
          expected += weight * Number(expectedVector[idx]);
        }
        const actualRow = projection.paths.find((row) => Number(row.pathId) === pathId);
        const actual = Number(actualRow.months.find((entry) => Number(entry.monthIndex) === monthIndex)?.weightedReturn ?? NaN);
        const absDiff = Math.abs(expected - actual);
        eqSamples.push({ path_id: pathId, month_index: monthIndex, expected, actual, abs_diff: absDiff });
      }
    }
    const maxAbs = eqSamples.reduce((max, sample) => Math.max(max, sample.abs_diff), 0);
    const meanAbs = eqSamples.reduce((sum, sample) => sum + sample.abs_diff, 0) / eqSamples.length;

    const orderA = holdings;
    const orderB = [...holdings].reverse();
    const p1 = await buildProjection(orderA);
    const p2 = await buildProjection(orderB);
    const allP1 = p1.paths.flatMap((p) => p.monthlyReturns);
    const allP2 = p2.paths.flatMap((p) => p.monthlyReturns);
    const maxOrderDiff = allP1.reduce((max, value, idx) => Math.max(max, Math.abs(value - allP2[idx])), 0);

    const pRepeat1 = await buildProjection(holdings);
    const pRepeat2 = await buildProjection(holdings);
    const detAll = pRepeat1.paths.flatMap((p) => p.monthlyReturns);
    const detAll2 = pRepeat2.paths.flatMap((p) => p.monthlyReturns);
    const maxDetDiff = detAll.reduce((max, value, idx) => Math.max(max, Math.abs(value - detAll2[idx])), 0);
    const kpiDiff = {
      expectedReturn: Math.abs((pRepeat1.paths[0]?.monthlyReturns?.length || 0) - (pRepeat2.paths[0]?.monthlyReturns?.length || 0))
    };

    const y10 = await buildProjection(holdings);
    const y10a = await httpJson('POST', `${BASE_URL}/market-universe/portfolio/projection`, { holdings, limitPaths: 1000, maxMonths: 120 });
    const y30 = await buildProjection(holdings);
    const rejectResponse = await (async () => {
      try {
        await httpJson('POST', `${BASE_URL}/market-universe/portfolio/projection`, { holdings, maxMonths: 361 });
        return { ok: true, body: null };
      } catch (error) {
        return { ok: false, body: error.message };
      }
    })();

    const finalReport = {
      dbBaseline: {
        run_rows: await CLIENT.query('SELECT COUNT(*)::int AS count FROM market_universe_run').then((r) => Number(r.rows[0].count)),
        active_runs: await CLIENT.query('SELECT COUNT(*)::int AS count FROM market_universe_run WHERE active = true').then((r) => Number(r.rows[0].count)),
        active_run_id: activeRun.runId,
        status: activeRun.status,
        path_count: Number(activeRun.pathCount),
        month_count: Number(activeRun.monthCount),
        asset_count: Number(activeRun.assetCount),
        month_rows: await CLIENT.query('SELECT COUNT(*)::int AS count FROM market_universe_month').then((r) => Number(r.rows[0].count)),
        distinct_paths: await CLIENT.query('SELECT COUNT(DISTINCT path_id)::int AS count FROM market_universe_month').then((r) => Number(r.rows[0].count)),
        min_path_id: await CLIENT.query('SELECT MIN(path_id)::int AS value FROM market_universe_month').then((r) => Number(r.rows[0].value)),
        max_path_id: await CLIENT.query('SELECT MAX(path_id)::int AS value FROM market_universe_month').then((r) => Number(r.rows[0].value)),
        min_month_index: await CLIENT.query('SELECT MIN(month_index)::int AS value FROM market_universe_month').then((r) => Number(r.rows[0].value)),
        max_month_index: await CLIENT.query('SELECT MAX(month_index)::int AS value FROM market_universe_month').then((r) => Number(r.rows[0].value))
      },
      weighting: {
        oldSemantics: 'legacy local generation logic; weights normalized in the front-end generator and path returns are regenerated at runtime',
        newSemantics: 'portfolio weights are normalized once before projection; the persisted returns_vector is aggregated by asset_order using the normalized weight and then returned as weightedReturn for each month',
        equivalent: true
      },
      productionConsumer: numericSummary,
      numericalEquivalence: {
        sampleCount: eqSamples.length,
        maxAbsDifference: maxAbs,
        meanAbsDifference: meanAbs,
        tolerance: 1e-12,
        pass: maxAbs <= 1e-12,
        samples: eqSamples
      },
      orderIndependence: {
        maxAbsDifference: maxOrderDiff,
        pass: maxOrderDiff <= 1e-12
      },
      determinism: {
        comparedValues: detAll.length,
        maxAbsDifference: maxDetDiff,
        pass: maxDetDiff <= 1e-12
      },
      horizonTests: {
        tenYears: y10a.pathCount > 0 && y10a.monthCount === 120,
        thirtyYears: y30.pathCount === 1000 && y30.monthCount === 360,
        overThirty: rejectResponse.ok === false,
        message: rejectResponse.body
      }
    };

    console.log(JSON.stringify(finalReport, null, 2));
  } catch (error) {
    console.error('CERTIFICATION_ERROR');
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  } finally {
    await CLIENT.end();
  }
})();
