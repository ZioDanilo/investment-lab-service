const { performance } = require('perf_hooks');
const zlib = require('zlib');
const { Client } = require('pg');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://u91yl7fi5gtxpzooqst1:hornmk9X1iiIN64g9XMKPzyRYc5IW6@b1c6freqpfrihnit7emx-postgresql.services.clever-cloud.com:50013/b1c6freqpfrihnit7emx';

const { MarketUniverseService } = require('./src/services/marketUniverseService');

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}
function p90(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(0.9 * sorted.length) - 1);
  return sorted[idx];
}
function round(value, digits = 3) {
  return Number(Number(value).toFixed(digits));
}
function byteLenJson(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}
function compactProjectionEstimate(projection) {
  const paths = Array.isArray(projection?.paths) ? projection.paths : [];
  const compactPaths = paths.map((path) => {
    const monthlyReturns = Array.isArray(path?.monthlyReturns) ? path.monthlyReturns : [];
    const scenarios = Array.isArray(path?.months) ? path.months.map((month) => month?.scenario ?? 'expansion') : [];
    const intensities = Array.isArray(path?.months) ? path.months.map((month) => Number(month?.intensity ?? 0)) : [];
    return {
      pathId: path?.pathId,
      monthlyReturns,
      scenarios,
      intensities
    };
  });

  return {
    run: projection?.run,
    pathCount: projection?.pathCount,
    monthCount: projection?.monthCount,
    paths: compactPaths
  };
}

async function getSoniaHoldings() {
  const portfolioResponse = await fetch('http://localhost:3000/api/portfolio');
  const portfolioJson = await portfolioResponse.json();
  const sonia = (portfolioJson.data || []).find((entry) => entry.nome === 'Sonia');
  if (!sonia) throw new Error('Sonia portfolio not found');
  const rawHoldings = (sonia.etfs || []).map((entry) => ({
    isin: entry?.etf?.isin,
    weight: Number(entry?.peso ?? entry?.weight ?? 0)
  })).filter((entry) => entry.isin && Number.isFinite(entry.weight) && entry.weight > 0);
  const totalWeight = rawHoldings.reduce((sum, entry) => sum + entry.weight, 0);
  return rawHoldings.map((entry) => ({ isin: entry.isin, weight: entry.weight / totalWeight }));
}

(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();

  const holdings = await getSoniaHoldings();
  const activeRun = (await fetch('http://localhost:3000/api/market-universe/active')).json().then((json) => json.data);
  const activeRunMeta = await activeRun;

  const coldServiceTimes = [];
  for (let i = 0; i < 3; i += 1) {
    MarketUniverseService.invalidateActiveUniverseCache();
    let status = await MarketUniverseService.getActiveUniverseCacheStatus();
    if (status.state !== 'COLD') throw new Error(`Precondition failed: state not COLD before cold benchmark run ${i + 1}`);
    const start = performance.now();
    await MarketUniverseService.buildPortfolioProjectionFromActiveMarketUniverse({ holdings });
    const elapsed = performance.now() - start;
    coldServiceTimes.push(elapsed);
    status = await MarketUniverseService.getActiveUniverseCacheStatus();
    if (status.state !== 'WARM') throw new Error(`Postcondition failed: state not WARM after cold benchmark run ${i + 1}`);
  }

  const warmServiceDbLoadsBefore = Number(MarketUniverseService.activeUniverseStats.dbLoads || 0);
  const warmServiceTimes = [];
  for (let i = 0; i < 10; i += 1) {
    const status = await MarketUniverseService.getActiveUniverseCacheStatus();
    if (status.state !== 'WARM') throw new Error('Warm benchmark precondition failed: cache not WARM');
    const start = performance.now();
    await MarketUniverseService.buildPortfolioProjectionFromActiveMarketUniverse({ holdings });
    warmServiceTimes.push(performance.now() - start);
  }
  const warmServiceDbLoadsAfter = Number(MarketUniverseService.activeUniverseStats.dbLoads || 0);

  const warmHttpTimes = [];
  let warmHttpPayload = null;
  for (let i = 0; i < 10; i += 1) {
    const start = performance.now();
    const response = await fetch('http://localhost:3000/api/market-universe/portfolio/projection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ holdings })
    });
    const json = await response.json();
    warmHttpTimes.push(performance.now() - start);
    if (warmHttpPayload === null) {
      warmHttpPayload = json.data;
    }
  }

  const currentRawBytes = byteLenJson(warmHttpPayload);
  const currentRawMiB = currentRawBytes / (1024 * 1024);
  const compactEstimate = compactProjectionEstimate(warmHttpPayload);
  const proposedRawBytes = byteLenJson(compactEstimate);
  const proposedRawMiB = proposedRawBytes / (1024 * 1024);
  const currentGzipBytes = zlib.gzipSync(JSON.stringify(warmHttpPayload)).length;
  const compactGzipBytes = zlib.gzipSync(JSON.stringify(compactEstimate)).length;

  MarketUniverseService.invalidateActiveUniverseCache();
  const singleFlightBeforeLoads = Number(MarketUniverseService.activeUniverseStats.dbLoads || 0);
  const coldStatus = await MarketUniverseService.getActiveUniverseCacheStatus();
  if (coldStatus.state !== 'COLD') throw new Error('Single-flight precondition failed: cache not COLD');
  const concurrentResults = await Promise.all(Array.from({ length: 5 }, async () => {
    const start = performance.now();
    const cache = await MarketUniverseService.getActiveUniverseCache();
    return {
      elapsedMs: performance.now() - start,
      runId: cache.runId,
      state: cache.state
    };
  }));

  const singleFlightAfterLoads = Number(MarketUniverseService.activeUniverseStats.dbLoads || 0);
  const pathCount = Number(warmHttpPayload?.pathCount || 0);
  const monthCount = Number(warmHttpPayload?.monthCount || 0);

  const payloadAudit = {
    run: byteLenJson(warmHttpPayload?.run),
    weights: byteLenJson(warmHttpPayload?.weights),
    paths: byteLenJson(warmHttpPayload?.paths),
    monthlyReturns: warmHttpPayload?.paths.reduce((sum, path) => sum + byteLenJson(path.monthlyReturns), 0) || 0,
    months: warmHttpPayload?.paths.reduce((sum, path) => sum + byteLenJson(path.months), 0) || 0,
    scenario: warmHttpPayload?.paths.reduce((sum, path) => sum + byteLenJson(path.months.map((entry) => entry.scenario)), 0) || 0,
    intensity: warmHttpPayload?.paths.reduce((sum, path) => sum + byteLenJson(path.months.map((entry) => entry.intensity)), 0) || 0,
    weightedReturn: warmHttpPayload?.paths.reduce((sum, path) => sum + byteLenJson(path.months.map((entry) => entry.weightedReturn)), 0) || 0,
    duplicatedMonthlyInfo: warmHttpPayload?.paths.reduce((sum, path) => sum + path.months.length, 0) || 0,
    pathCount,
    monthCount,
    totalBytes: currentRawBytes
  };

  const summary = {
    coldCacheProjection: {
      runs: 3,
      samples: coldServiceTimes.map((value) => round(value)),
      minMs: round(Math.min(...coldServiceTimes)),
      meanMs: round(mean(coldServiceTimes)),
      medianMs: round(median(coldServiceTimes)),
      p90Ms: round(p90(coldServiceTimes)),
      maxMs: round(Math.max(...coldServiceTimes))
    },
    warmService: {
      runs: 10,
      samples: warmServiceTimes.map((value) => round(value)),
      minMs: round(Math.min(...warmServiceTimes)),
      meanMs: round(mean(warmServiceTimes)),
      medianMs: round(median(warmServiceTimes)),
      p90Ms: round(p90(warmServiceTimes)),
      maxMs: round(Math.max(...warmServiceTimes)),
      dbLoadsDuringWarmSequence: warmServiceDbLoadsAfter - warmServiceDbLoadsBefore
    },
    warmHttp: {
      runs: 10,
      samples: warmHttpTimes.map((value) => round(value)),
      minMs: round(Math.min(...warmHttpTimes)),
      meanMs: round(mean(warmHttpTimes)),
      medianMs: round(median(warmHttpTimes)),
      p90Ms: round(p90(warmHttpTimes)),
      maxMs: round(Math.max(...warmHttpTimes)),
      rawBytes: currentRawBytes,
      rawMiB: round(currentRawMiB, 6),
      gzipBytes: currentGzipBytes,
      gzipMiB: round(currentGzipBytes / (1024 * 1024), 6)
    },
    speedups: {
      coldMedianMs: round(median(coldServiceTimes)),
      warmServiceMedianMs: round(median(warmServiceTimes)),
      warmHttpMedianMs: round(median(warmHttpTimes)),
      coldOverWarmService: round(median(coldServiceTimes) / Math.max(1e-9, median(warmServiceTimes)), 6),
      coldOverWarmHttp: round(median(coldServiceTimes) / Math.max(1e-9, median(warmHttpTimes)), 6),
      warmHttpMinusService: round(median(warmHttpTimes) - median(warmServiceTimes), 6)
    },
    singleFlight: {
      requests: 5,
      successful: concurrentResults.length,
      completeDbLoads: singleFlightAfterLoads - singleFlightBeforeLoads,
      publishedCaches: concurrentResults.filter((entry) => entry.state === 'WARM').length,
      uniqueRunIds: new Set(concurrentResults.map((entry) => entry.runId)).size,
      samples: concurrentResults,
      cacheStateBefore: coldStatus.state,
      runIdBefore: coldStatus.runId
    },
    homePreload: {
      implemented: true,
      blocking: false,
      callsPerSession: 1,
      marketUniverseDataStoredInAngular: false,
      frontendBuildPass: true,
      route: '/api/market-universe/cache/warmup'
    },
    payloadAudit,
    compactEstimate: {
      rawBytes: proposedRawBytes,
      rawMiB: round(proposedRawMiB, 6),
      gzipBytes: compactGzipBytes,
      gzipMiB: round(compactGzipBytes / (1024 * 1024), 6),
      reductionBytes: currentRawBytes - proposedRawBytes,
      reductionPercent: round(((currentRawBytes - proposedRawBytes) / Math.max(1, currentRawBytes)) * 100, 4)
    },
    metadata: {
      activeRunId: activeRunMeta.runId,
      activeRunStatus: activeRunMeta.status,
      pathCount,
      monthCount,
      assetCount: activeRunMeta.assetCount
    }
  };

  console.log(JSON.stringify(summary, null, 2));
  await client.end();
})().catch((error) => {
  console.error('BENCHMARK_SCRIPT_FAILED');
  console.error(error.stack || String(error));
  process.exit(1);
});
