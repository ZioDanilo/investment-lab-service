const { performance } = require('perf_hooks');
const zlib = require('zlib');

const DB_URL = process.env.DATABASE_URL || 'postgresql://u91yl7fi5gtxpzooqst1:hornmk9X1iiIN64g9XMKPzyRYc5IW6@b1c6freqpfrihnit7emx-postgresql.services.clever-cloud.com:50013/b1c6freqpfrihnit7emx';
process.env.DATABASE_URL = DB_URL;

function byteLenJson(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}
function round(value, digits = 6) {
  return Number(Number(value).toFixed(digits));
}
function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.json();
}

async function getSoniaProjection() {
  const portfolioJson = await fetchJson('http://localhost:3000/api/portfolio');
  const portfolios = Array.isArray(portfolioJson?.data) ? portfolioJson.data : [];
  const sonia = portfolios.find((entry) => String(entry?.nome || '').trim() === 'Sonia');
  if (!sonia) throw new Error('Sonia portfolio not found');

  const rawHoldings = (Array.isArray(sonia.etfs) ? sonia.etfs : []).map((entry) => ({
    isin: entry?.etf?.isin,
    weight: Number(entry?.peso ?? entry?.weight ?? 0)
  })).filter((entry) => entry.isin && Number.isFinite(entry.weight) && entry.weight > 0);

  const total = rawHoldings.reduce((sum, item) => sum + item.weight, 0);
  const holdings = rawHoldings.map((item) => ({ isin: item.isin, weight: item.weight / total }));

  const result = await fetchJson('http://localhost:3000/api/market-universe/portfolio/projection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ holdings })
  });
  return result?.data ?? result;
}

async function getProjectionForPortfolioName(name) {
  const portfolioJson = await fetchJson('http://localhost:3000/api/portfolio');
  const portfolios = Array.isArray(portfolioJson?.data) ? portfolioJson.data : [];
  const target = portfolios.find((entry) => String(entry?.nome || '').trim() === name);
  if (!target) throw new Error(`Portfolio ${name} not found`);

  const rawHoldings = (Array.isArray(target.etfs) ? target.etfs : []).map((entry) => ({
    isin: entry?.etf?.isin,
    weight: Number(entry?.peso ?? entry?.weight ?? 0)
  })).filter((entry) => entry.isin && Number.isFinite(entry.weight) && entry.weight > 0);

  const total = rawHoldings.reduce((sum, item) => sum + item.weight, 0);
  const holdings = rawHoldings.map((item) => ({ isin: item.isin, weight: item.weight / total }));

  const result = await fetchJson('http://localhost:3000/api/market-universe/portfolio/projection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ holdings })
  });
  return result?.data ?? result;
}

function compareMonthlyDuplication(projection) {
  let comparisons = 0;
  let mismatches = 0;
  let maxAbsDiff = 0;
  let monthIndexMismatches = 0;

  for (const path of projection.paths) {
    const months = Array.isArray(path?.months) ? path.months : [];
    const monthlyReturns = Array.isArray(path?.monthlyReturns) ? path.monthlyReturns : [];
    for (let i = 0; i < months.length; i += 1) {
      comparisons += 1;
      const expected = Number(monthlyReturns[i] ?? 0);
      const actual = Number(months[i]?.weightedReturn ?? 0);
      const diff = Math.abs(expected - actual);
      if (diff > 0) mismatches += 1;
      if (diff > maxAbsDiff) maxAbsDiff = diff;
      if (Number(months[i]?.monthIndex ?? -1) !== i) monthIndexMismatches += 1;
    }
  }

  return {
    comparisons,
    mismatches,
    maxAbsDiff,
    monthIndexMismatches,
    monthIndexPass: monthIndexMismatches === 0
  };
}

function flattenScenarioIntensity(projection) {
  const scenarios = [];
  const intensities = [];
  for (const path of Array.isArray(projection?.paths) ? projection.paths : []) {
    for (const month of Array.isArray(path?.months) ? path.months : []) {
      scenarios.push(month?.scenario ?? 'expansion');
      intensities.push(Number(month?.intensity ?? 0));
    }
  }
  return { scenarios, intensities };
}

function createCompactJsonCandidate(projection) {
  const paths = Array.isArray(projection?.paths) ? projection.paths : [];
  const flatScenarios = [];
  const flatIntensities = [];
  const compactPaths = paths.map((path) => {
    const monthlyReturns = Array.isArray(path?.monthlyReturns) ? path.monthlyReturns.map((value) => Number(value)) : [];
    for (const month of Array.isArray(path?.months) ? path.months : []) {
      flatScenarios.push(month?.scenario ?? 'expansion');
      flatIntensities.push(Number(month?.intensity ?? 0));
    }
    return { pathId: Number(path?.pathId ?? 0), monthlyReturns };
  });
  return {
    runId: projection?.run?.runId ?? '',
    pathCount: Number(projection?.pathCount ?? compactPaths.length),
    monthCount: Number(projection?.monthCount ?? (compactPaths[0]?.monthlyReturns.length ?? 0)),
    paths: compactPaths,
    scenarios: flatScenarios,
    intensities: flatIntensities
  };
}

function buildBinaryCandidate(projection) {
  const paths = Array.isArray(projection?.paths) ? projection.paths : [];
  const pathCount = paths.length;
  const monthCount = Number(projection?.monthCount ?? (paths[0]?.monthlyReturns.length ?? 0));
  const totalValues = pathCount * monthCount;
  const monthlyReturns = new Float64Array(totalValues);
  const intensities = new Float64Array(totalValues);
  const scenarios = new Uint8Array(totalValues);

  const scenarioMap = { expansion: 0, soft_landing: 1, recession: 2, stagflation: 3 };

  for (let pathIndex = 0; pathIndex < pathCount; pathIndex += 1) {
    const path = paths[pathIndex];
    const months = Array.isArray(path?.months) ? path.months : [];
    for (let monthIndex = 0; monthIndex < monthCount; monthIndex += 1) {
      const flatIndex = pathIndex * monthCount + monthIndex;
      const month = months[monthIndex] ?? {};
      monthlyReturns[flatIndex] = Number(path?.monthlyReturns?.[monthIndex] ?? month?.weightedReturn ?? 0);
      intensities[flatIndex] = Number(month?.intensity ?? 0);
      const scenarioName = month?.scenario ?? 'expansion';
      scenarios[flatIndex] = Number.isInteger(scenarioMap[scenarioName]) ? scenarioMap[scenarioName] : scenarioMap.expansion;
    }
  }

  const header = {
    version: 1,
    runId: projection?.run?.runId ?? '',
    pathCount,
    monthCount,
    scenarioDictionary: { expansion: 0, soft_landing: 1, recession: 2, stagflation: 3 },
    dataLayout: 'flat-path-major: [path][month] => monthlyReturns, intensities, scenarios'
  };

  return { header, monthlyReturns, intensities, scenarios, totalValues };
}

function encodeBinaryBuffer(binaryCandidate) {
  const runIdBytes = Buffer.from(String(binaryCandidate.header.runId || ''), 'utf8');
  const runIdLength = runIdBytes.length;
  const totalBytes = 4 + 4 + 4 + 4 + 4 + 4 + runIdLength +
    binaryCandidate.monthlyReturns.byteLength +
    binaryCandidate.intensities.byteLength +
    binaryCandidate.scenarios.byteLength;
  const buffer = Buffer.allocUnsafe(totalBytes);
  let offset = 0;

  buffer.writeUInt32LE(1, offset); offset += 4;
  buffer.writeUInt32LE(binaryCandidate.header.pathCount, offset); offset += 4;
  buffer.writeUInt32LE(binaryCandidate.header.monthCount, offset); offset += 4;
  buffer.writeUInt32LE(runIdLength, offset); offset += 4;
  buffer.writeUInt32LE(binaryCandidate.totalValues, offset); offset += 4;
  runIdBytes.copy(buffer, offset); offset += runIdLength;

  Buffer.from(binaryCandidate.monthlyReturns.buffer, binaryCandidate.monthlyReturns.byteOffset, binaryCandidate.monthlyReturns.byteLength).copy(buffer, offset); offset += binaryCandidate.monthlyReturns.byteLength;
  Buffer.from(binaryCandidate.intensities.buffer, binaryCandidate.intensities.byteOffset, binaryCandidate.intensities.byteLength).copy(buffer, offset); offset += binaryCandidate.intensities.byteLength;
  Buffer.from(binaryCandidate.scenarios.buffer, binaryCandidate.scenarios.byteOffset, binaryCandidate.scenarios.byteLength).copy(buffer, offset);

  return buffer;
}

function decodeBinaryBuffer(buffer) {
  let offset = 0;
  const version = buffer.readUInt32LE(offset); offset += 4;
  const pathCount = buffer.readUInt32LE(offset); offset += 4;
  const monthCount = buffer.readUInt32LE(offset); offset += 4;
  const runIdLength = buffer.readUInt32LE(offset); offset += 4;
  const totalValues = buffer.readUInt32LE(offset); offset += 4;
  const runId = buffer.toString('utf8', offset, offset + runIdLength); offset += runIdLength;
  const returnsLength = totalValues * 8;
  const monthlyReturns = new Float64Array(buffer.buffer, buffer.byteOffset + offset, totalValues); offset += returnsLength;
  const intensities = new Float64Array(buffer.buffer, buffer.byteOffset + offset, totalValues); offset += totalValues * 8;
  const scenarios = new Uint8Array(buffer.buffer, buffer.byteOffset + offset, totalValues);
  return { version, pathCount, monthCount, runId, monthlyReturns, intensities, scenarios };
}

(async () => {
  const currentProjection = await getSoniaProjection();
  const otherProjection = await getProjectionForPortfolioName('Danilo');

  const dupAudit = compareMonthlyDuplication(currentProjection);
  const scenarioMap = flattenScenarioIntensity(currentProjection);
  const scenarioMapOther = flattenScenarioIntensity(otherProjection);

  let scenarioMismatchCount = 0;
  let intensityMismatchCount = 0;
  for (let index = 0; index < Math.min(scenarioMap.scenarios.length, scenarioMapOther.scenarios.length); index += 1) {
    if (String(scenarioMap.scenarios[index]) !== String(scenarioMapOther.scenarios[index])) scenarioMismatchCount += 1;
    if (Number(scenarioMap.intensities[index]) !== Number(scenarioMapOther.intensities[index])) intensityMismatchCount += 1;
  }

  const compactCandidate = createCompactJsonCandidate(currentProjection);
  const binaryCandidate = buildBinaryCandidate(currentProjection);
  const binaryBuffer = encodeBinaryBuffer(binaryCandidate);
  const decoded = decodeBinaryBuffer(binaryBuffer);

  let monthlyReturnDiff = 0;
  let intensityDiff = 0;
  let scenarioDiff = 0;
  let pathIdentityMismatch = 0;
  let monthIdentityMismatch = 0;
  let runMismatch = 0;
  const expectedMonthlyReturns = currentProjection.paths.flatMap((path) => path.monthlyReturns || []);
  const expectedScenarios = currentProjection.paths.flatMap((path) => (path.months || []).map((m) => m.scenario));
  const expectedIntensities = currentProjection.paths.flatMap((path) => (path.months || []).map((m) => Number(m.intensity ?? 0)));

  for (let index = 0; index < expectedMonthlyReturns.length; index += 1) {
    const expected = Number(expectedMonthlyReturns[index]);
    const got = Number(decoded.monthlyReturns[index]);
    if (Math.abs(expected - got) > 0) monthlyReturnDiff += 1;
  }
  for (let index = 0; index < expectedIntensities.length; index += 1) {
    const expected = Number(expectedIntensities[index]);
    const got = Number(decoded.intensities[index]);
    if (Math.abs(expected - got) > 0) intensityDiff += 1;
  }
  for (let index = 0; index < expectedScenarios.length; index += 1) {
    const expected = String(expectedScenarios[index]);
    const got = String({ 0: 'expansion', 1: 'soft_landing', 2: 'recession', 3: 'stagflation' }[decoded.scenarios[index]] || 'expansion');
    if (expected !== got) scenarioDiff += 1;
  }

  if (decoded.runId !== currentProjection.run.runId) runMismatch += 1;
  if (currentProjection.pathCount !== decoded.pathCount) pathIdentityMismatch += 1;
  if (currentProjection.monthCount !== decoded.monthCount) monthIdentityMismatch += 1;

  const currentRawBytes = byteLenJson(currentProjection);
  const currentGzipBytes = zlib.gzipSync(JSON.stringify(currentProjection)).length;
  const currentBrotliBytes = zlib.brotliCompressSync(Buffer.from(JSON.stringify(currentProjection), 'utf8')).length;

  const compactJsonBytes = byteLenJson(compactCandidate);
  const compactGzipBytes = zlib.gzipSync(JSON.stringify(compactCandidate)).length;
  const compactBrotliBytes = zlib.brotliCompressSync(Buffer.from(JSON.stringify(compactCandidate), 'utf8')).length;

  const binaryRawBytes = binaryBuffer.length;
  const binaryGzipBytes = zlib.gzipSync(binaryBuffer).length;
  const binaryBrotliBytes = zlib.brotliCompressSync(binaryBuffer).length;

  const jsonBefore = process.memoryUsage();
  const jsonString = JSON.stringify(currentProjection);
  const jsonAfter = process.memoryUsage();
  const compactJsonString = JSON.stringify(compactCandidate);
  const compactJsonAfter = process.memoryUsage();
  const binaryObj = buildBinaryCandidate(currentProjection);
  const binaryAfter = process.memoryUsage();

  const httpHeaders = await fetch('http://localhost:3000/api/market-universe/portfolio/projection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ holdings: [{ isin: 'TEST', weight: 1 }] })
  });

  const compressionAudit = {
    contentEncoding: httpHeaders.headers.get('content-encoding'),
    contentLength: httpHeaders.headers.get('content-length'),
    transferEncoding: httpHeaders.headers.get('transfer-encoding'),
    status: httpHeaders.status,
    hasCompressionMiddleware: false
  };

  const jsonEncodeStart = performance.now();
  const jsonStringified = JSON.stringify(currentProjection);
  const jsonEncodeMs = performance.now() - jsonEncodeStart;
  const jsonParseStart = performance.now();
  JSON.parse(jsonStringified);
  const jsonParseMs = performance.now() - jsonParseStart;

  const compactEncodeStart = performance.now();
  const compactStringified = JSON.stringify(compactCandidate);
  const compactEncodeMs = performance.now() - compactEncodeStart;
  const compactParseStart = performance.now();
  JSON.parse(compactStringified);
  const compactParseMs = performance.now() - compactParseStart;

  const binaryEncodeStart = performance.now();
  const binaryBuffer2 = encodeBinaryBuffer(binaryCandidate);
  const binaryEncodeMs = performance.now() - binaryEncodeStart;
  const binaryDecodeStart = performance.now();
  const decoded2 = decodeBinaryBuffer(binaryBuffer2);
  const binaryDecodeMs = performance.now() - binaryDecodeStart;

  const gzipStart = performance.now();
  zlib.gzipSync(binaryBuffer2);
  const gzipMs = performance.now() - gzipStart;
  const brotliStart = performance.now();
  zlib.brotliCompressSync(binaryBuffer2);
  const brotliMs = performance.now() - brotliStart;

  const gzipDecompressStart = performance.now();
  zlib.gunzipSync(zlib.gzipSync(binaryBuffer2));
  const gzipDecompressMs = performance.now() - gzipDecompressStart;
  const brotliDecompressStart = performance.now();
  zlib.brotliDecompressSync(zlib.brotliCompressSync(binaryBuffer2));
  const brotliDecompressMs = performance.now() - brotliDecompressStart;

  const result = {
    duplicationProof: {
      comparisons: dupAudit.comparisons,
      mismatches: dupAudit.mismatches,
      maxAbsDiff: dupAudit.maxAbsDiff,
      monthIndexMismatches: dupAudit.monthIndexMismatches,
      monthlyReturnsEqualToWeightedReturn: dupAudit.mismatches === 0,
      monthIndexDerivable: dupAudit.monthIndexMismatches === 0
    },
    runScopedMetadata: {
      scenarioMismatchCount,
      intensityMismatchCount,
      scenarioAndIntensityInvariantAcrossHoldings: scenarioMismatchCount === 0 && intensityMismatchCount === 0
    },
    size: {
      currentJsonRawBytes: currentRawBytes,
      currentJsonRawMiB: currentRawBytes / (1024 * 1024),
      currentGzipBytes: currentGzipBytes,
      currentGzipMiB: currentGzipBytes / (1024 * 1024),
      currentBrotliBytes: currentBrotliBytes,
      currentBrotliMiB: currentBrotliBytes / (1024 * 1024),
      compactJsonRawBytes: compactJsonBytes,
      compactJsonRawMiB: compactJsonBytes / (1024 * 1024),
      compactJsonGzipBytes: compactGzipBytes,
      compactJsonGzipMiB: compactGzipBytes / (1024 * 1024),
      compactJsonBrotliBytes: compactBrotliBytes,
      compactJsonBrotliMiB: compactBrotliBytes / (1024 * 1024),
      binaryRawBytes: binaryRawBytes,
      binaryRawMiB: binaryRawBytes / (1024 * 1024),
      binaryGzipBytes: binaryGzipBytes,
      binaryGzipMiB: binaryGzipBytes / (1024 * 1024),
      binaryBrotliBytes: binaryBrotliBytes,
      binaryBrotliMiB: binaryBrotliBytes / (1024 * 1024)
    },
    cpu: {
      jsonEncodeMs: round(jsonEncodeMs),
      jsonParseMs: round(jsonParseMs),
      compactJsonEncodeMs: round(compactEncodeMs),
      compactJsonParseMs: round(compactParseMs),
      binaryEncodeMs: round(binaryEncodeMs),
      binaryDecodeMs: round(binaryDecodeMs),
      gzipMs: round(gzipMs),
      brotliMs: round(brotliMs),
      gzipDecompressMs: round(gzipDecompressMs),
      brotliDecompressMs: round(brotliDecompressMs)
    },
    exactness: {
      monthlyReturnMismatchCount: monthlyReturnDiff,
      scenarioMismatchCount: scenarioDiff,
      intensityMismatchCount: intensityDiff,
      runMismatchCount: runMismatch,
      pathIdentityMismatchCount: pathIdentityMismatch,
      monthIdentityMismatchCount: monthIdentityMismatch,
      maxAbsDiff: dupAudit.maxAbsDiff,
      allPass: monthlyReturnDiff === 0 && scenarioDiff === 0 && intensityDiff === 0 && runMismatch === 0 && pathIdentityMismatch === 0 && monthIdentityMismatch === 0
    },
    http: compressionAudit,
    memory: {
      heapBefore: jsonBefore.heapUsed,
      heapAfter: jsonAfter.heapUsed,
      heapDelta: jsonAfter.heapUsed - jsonBefore.heapUsed,
      compactHeapAfter: compactJsonAfter.heapUsed - jsonAfter.heapUsed,
      binaryHeapAfter: binaryAfter.heapUsed - compactJsonAfter.heapUsed
    }
  };

  console.log(JSON.stringify(result, null, 2));
})().catch((error) => {
  console.error('TRANSPORT_AUDIT_FAILURE');
  console.error(error.stack || String(error));
  process.exit(1);
});
