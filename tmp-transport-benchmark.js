const { performance } = require('perf_hooks');
const http = require('http');
const zlib = require('zlib');

const REAL_BACKEND = 'http://localhost:3000';
const BENCH_PORT = 3910;
const ITERATIONS = 5;
const COMPRESSION_ITERATIONS = 5;
const LOCALHOST_ITERATIONS = 5;

function round(value, digits = 3) {
  return Number(Number(value).toFixed(digits));
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
function stats(values) {
  return {
    min: Math.min(...values),
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    median: median(values),
    p90: p90(values),
    max: Math.max(...values)
  };
}
function byteMiB(bytes) {
  return bytes / (1024 * 1024);
}
function toNum(value) {
  return Number(value ?? 0);
}

function makeCompactProjection(projection) {
  const flatScenarios = [];
  const flatIntensities = [];
  const compactPaths = (Array.isArray(projection?.paths) ? projection.paths : []).map((path) => {
    const monthlyReturns = Array.isArray(path?.monthlyReturns) ? path.monthlyReturns.map((value) => Number(value)) : [];
    for (const month of Array.isArray(path?.months) ? path.months : []) {
      flatScenarios.push(month?.scenario ?? 'expansion');
      flatIntensities.push(Number(month?.intensity ?? 0));
    }
    return { pathId: Number(path?.pathId ?? 0), monthlyReturns };
  });
  return {
    runId: String(projection?.run?.runId ?? ''),
    pathCount: Number(projection?.pathCount ?? compactPaths.length),
    monthCount: Number(projection?.monthCount ?? (compactPaths[0]?.monthlyReturns.length ?? 0)),
    paths: compactPaths,
    scenarios: flatScenarios,
    intensities: flatIntensities
  };
}

function makeBinaryFull(projection) {
  const pathCount = Number(projection?.pathCount ?? 0);
  const monthCount = Number(projection?.monthCount ?? 0);
  const totalValues = pathCount * monthCount;
  const scenarioMap = { expansion: 0, soft_landing: 1, recession: 2, stagflation: 3 };
  const monthlyReturns = new Float64Array(totalValues);
  const intensities = new Float64Array(totalValues);
  const scenarios = new Uint8Array(totalValues);
  let flatIndex = 0;

  for (const path of Array.isArray(projection?.paths) ? projection.paths : []) {
    const months = Array.isArray(path?.months) ? path.months : [];
    for (let monthIndex = 0; monthIndex < monthCount; monthIndex += 1) {
      const month = months[monthIndex] ?? {};
      monthlyReturns[flatIndex] = Number(path?.monthlyReturns?.[monthIndex] ?? month?.weightedReturn ?? 0);
      intensities[flatIndex] = Number(month?.intensity ?? 0);
      const scenarioName = month?.scenario ?? 'expansion';
      scenarios[flatIndex] = Number.isInteger(scenarioMap[scenarioName]) ? scenarioMap[scenarioName] : 0;
      flatIndex += 1;
    }
  }

  const runIdBuffer = Buffer.from(String(projection?.run?.runId || ''), 'utf8');
  const headerSize = 4 + 4 + 4 + 4 + 4 + runIdBuffer.length;
  const totalBufferSize = headerSize + monthlyReturns.byteLength + intensities.byteLength + scenarios.byteLength;
  const buffer = Buffer.allocUnsafe(totalBufferSize);
  let offset = 0;

  buffer.writeUInt32LE(1, offset); offset += 4;
  buffer.writeUInt32LE(pathCount, offset); offset += 4;
  buffer.writeUInt32LE(monthCount, offset); offset += 4;
  buffer.writeUInt32LE(runIdBuffer.length, offset); offset += 4;
  buffer.writeUInt32LE(totalValues, offset); offset += 4;
  runIdBuffer.copy(buffer, offset); offset += runIdBuffer.length;

  const returnsView = Buffer.from(monthlyReturns.buffer, monthlyReturns.byteOffset, monthlyReturns.byteLength);
  const intensityView = Buffer.from(intensities.buffer, intensities.byteOffset, intensities.byteLength);
  const scenarioView = Buffer.from(scenarios.buffer, scenarios.byteOffset, scenarios.byteLength);
  returnsView.copy(buffer, offset); offset += returnsView.length;
  intensityView.copy(buffer, offset); offset += intensityView.length;
  scenarioView.copy(buffer, offset);

  return {
    buffer,
    header: {
      version: 1,
      runId: String(projection?.run?.runId || ''),
      pathCount,
      monthCount,
      totalValues,
      scenarioDictionary: { expansion: 0, soft_landing: 1, recession: 2, stagflation: 3 }
    },
    totalValues,
    monthlyReturns,
    intensities,
    scenarios
  };
}

function makeBinaryReturnsOnly(projection) {
  const pathCount = Number(projection?.pathCount ?? 0);
  const monthCount = Number(projection?.monthCount ?? 0);
  const totalValues = pathCount * monthCount;
  const monthlyReturns = new Float64Array(totalValues);
  let flatIndex = 0;

  for (const path of Array.isArray(projection?.paths) ? projection.paths : []) {
    const months = Array.isArray(path?.months) ? path.months : [];
    for (let monthIndex = 0; monthIndex < monthCount; monthIndex += 1) {
      const month = months[monthIndex] ?? {};
      monthlyReturns[flatIndex] = Number(path?.monthlyReturns?.[monthIndex] ?? month?.weightedReturn ?? 0);
      flatIndex += 1;
    }
  }

  const runIdBuffer = Buffer.from(String(projection?.run?.runId || ''), 'utf8');
  const headerSize = 4 + 4 + 4 + 4 + 4 + runIdBuffer.length;
  const buffer = Buffer.allocUnsafe(headerSize + monthlyReturns.byteLength);
  let offset = 0;
  buffer.writeUInt32LE(1, offset); offset += 4;
  buffer.writeUInt32LE(pathCount, offset); offset += 4;
  buffer.writeUInt32LE(monthCount, offset); offset += 4;
  buffer.writeUInt32LE(runIdBuffer.length, offset); offset += 4;
  buffer.writeUInt32LE(totalValues, offset); offset += 4;
  runIdBuffer.copy(buffer, offset); offset += runIdBuffer.length;
  Buffer.from(monthlyReturns.buffer, monthlyReturns.byteOffset, monthlyReturns.byteLength).copy(buffer, offset);

  return {
    buffer,
    header: {
      version: 1,
      runId: String(projection?.run?.runId || ''),
      pathCount,
      monthCount,
      totalValues,
      mode: 'returns-only'
    },
    totalValues,
    monthlyReturns
  };
}

function decodeBinaryFull(buffer) {
  let offset = 0;
  const version = buffer.readUInt32LE(offset); offset += 4;
  const pathCount = buffer.readUInt32LE(offset); offset += 4;
  const monthCount = buffer.readUInt32LE(offset); offset += 4;
  const runIdLength = buffer.readUInt32LE(offset); offset += 4;
  const totalValues = buffer.readUInt32LE(offset); offset += 4;
  const runId = buffer.toString('utf8', offset, offset + runIdLength); offset += runIdLength;
  const returnsLength = totalValues * 8;
  const returns = new Float64Array(buffer.buffer, buffer.byteOffset + offset, totalValues); offset += returnsLength;
  const intensities = new Float64Array(buffer.buffer, buffer.byteOffset + offset, totalValues); offset += totalValues * 8;
  const scenarios = new Uint8Array(buffer.buffer, buffer.byteOffset + offset, totalValues);
  return { version, pathCount, monthCount, runId, totalValues, returns, intensities, scenarios };
}

function decodeBinaryReturnsOnly(buffer) {
  let offset = 0;
  const version = buffer.readUInt32LE(offset); offset += 4;
  const pathCount = buffer.readUInt32LE(offset); offset += 4;
  const monthCount = buffer.readUInt32LE(offset); offset += 4;
  const runIdLength = buffer.readUInt32LE(offset); offset += 4;
  const totalValues = buffer.readUInt32LE(offset); offset += 4;
  const runId = buffer.toString('utf8', offset, offset + runIdLength); offset += runIdLength;
  const returns = new Float64Array(buffer.buffer, buffer.byteOffset + offset, totalValues);
  return { version, pathCount, monthCount, runId, totalValues, returns };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.json();
}

async function getSoniaProjection() {
  const portfolioJson = await fetchJson(`${REAL_BACKEND}/api/portfolio`);
  const portfolios = Array.isArray(portfolioJson?.data) ? portfolioJson.data : [];
  const sonia = portfolios.find((entry) => String(entry?.nome || '').trim() === 'Sonia');
  if (!sonia) throw new Error('Sonia portfolio missing');

  const rawHoldings = (Array.isArray(sonia.etfs) ? sonia.etfs : []).map((entry) => ({
    isin: entry?.etf?.isin,
    weight: Number(entry?.peso ?? entry?.weight ?? 0)
  })).filter((entry) => entry.isin && Number.isFinite(entry.weight) && entry.weight > 0);

  const total = rawHoldings.reduce((sum, item) => sum + item.weight, 0);
  const holdings = rawHoldings.map((item) => ({ isin: item.isin, weight: item.weight / total }));

  const result = await fetchJson(`${REAL_BACKEND}/api/market-universe/portfolio/projection`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ holdings })
  });
  return result?.data ?? result;
}

async function benchmarkEncodeDecode() {
  const projection = await getSoniaProjection();
  const compactProjection = makeCompactProjection(projection);
  const binaryFull = makeBinaryFull(projection);
  const binaryReturns = makeBinaryReturnsOnly(projection);

  const currentJson = JSON.stringify(projection);
  const compactJson = JSON.stringify(compactProjection);

  const encodeCases = {
    currentJSON: { label: 'currentJSON', payload: currentJson, encode: () => JSON.stringify(projection), decode: (value) => JSON.parse(value) },
    compactJSON: { label: 'compactJSON', payload: compactJson, encode: () => JSON.stringify(compactProjection), decode: (value) => JSON.parse(value) },
    binaryFull: { label: 'binaryFull', payload: binaryFull.buffer, encode: () => makeBinaryFull(projection).buffer, decode: (value) => decodeBinaryFull(Buffer.from(value)) },
    binaryReturnsOnly: { label: 'binaryReturnsOnly', payload: binaryReturns.buffer, encode: () => makeBinaryReturnsOnly(projection).buffer, decode: (value) => decodeBinaryReturnsOnly(Buffer.from(value)) }
  };

  const results = {};
  for (const [key, entry] of Object.entries(encodeCases)) {
    const encodeSamples = [];
    const decodeSamples = [];
    for (let i = 0; i < ITERATIONS; i += 1) {
      const encodeStart = performance.now();
      const encoded = entry.encode();
      encodeSamples.push(performance.now() - encodeStart);

      const decodeStart = performance.now();
      const decoded = entry.decode(encoded);
      decodeSamples.push(performance.now() - decodeStart);
      if (key === 'currentJSON' && decoded?.run?.runId !== projection.run.runId) throw new Error('currentJSON roundtrip failed');
      if (key === 'compactJSON' && decoded?.runId !== compactProjection.runId) throw new Error('compactJSON roundtrip failed');
      if (key === 'binaryFull' && decoded?.runId !== projection.run.runId) throw new Error('binaryFull roundtrip failed');
      if (key === 'binaryReturnsOnly' && decoded?.runId !== projection.run.runId) throw new Error('binaryReturnsOnly roundtrip failed');
    }
    results[key] = {
      encode: stats(encodeSamples),
      decode: stats(decodeSamples),
      rawBytes: Buffer.byteLength(entry.payload instanceof Uint8Array ? Buffer.from(entry.payload) : Buffer.from(entry.payload), 'utf8')
    };
    if (typeof entry.payload === 'string') {
      results[key].rawBytes = Buffer.byteLength(entry.payload, 'utf8');
    } else if (Buffer.isBuffer(entry.payload)) {
      results[key].rawBytes = entry.payload.length;
    } else if (entry.payload instanceof ArrayBuffer) {
      results[key].rawBytes = entry.payload.byteLength;
    }
  }

  // exactness checks
  const returnCount = projection.paths.reduce((sum, path) => sum + (Array.isArray(path?.monthlyReturns) ? path.monthlyReturns.length : 0), 0);
  const decodedBinary = decodeBinaryFull(binaryFull.buffer);
  let returnMismatches = 0;
  let maxReturnDiff = 0;
  let intensityMismatches = 0;
  let maxIntensityDiff = 0;
  let scenarioMismatches = 0;

  for (let pathIndex = 0; pathIndex < projection.paths.length; pathIndex += 1) {
    const path = projection.paths[pathIndex];
    for (let monthIndex = 0; monthIndex < projection.monthCount; monthIndex += 1) {
      const flatIndex = pathIndex * projection.monthCount + monthIndex;
      const expectedReturn = Number(path.monthlyReturns[monthIndex] ?? 0);
      const actualReturn = Number(decodedBinary.returns[flatIndex] ?? 0);
      const expectedIntensity = Number((path.months?.[monthIndex]?.intensity ?? 0));
      const actualIntensity = Number(decodedBinary.intensities[flatIndex] ?? 0);
      const expectedScenario = String((path.months?.[monthIndex]?.scenario ?? 'expansion'));
      const scenarioDictionary = { 0: 'expansion', 1: 'soft_landing', 2: 'recession', 3: 'stagflation' };
      const actualScenario = String(scenarioDictionary[decodedBinary.scenarios[flatIndex]] ?? 'expansion');
      if (Math.abs(expectedReturn - actualReturn) > 0) returnMismatches += 1;
      if (Math.abs(expectedReturn - actualReturn) > maxReturnDiff) maxReturnDiff = Math.abs(expectedReturn - actualReturn);
      if (Math.abs(expectedIntensity - actualIntensity) > 0) intensityMismatches += 1;
      if (Math.abs(expectedIntensity - actualIntensity) > maxIntensityDiff) maxIntensityDiff = Math.abs(expectedIntensity - actualIntensity);
      if (expectedScenario !== actualScenario) scenarioMismatches += 1;
    }
  }

  const exactness = {
    returnsCompared: returnCount,
    returnMismatches,
    maxReturnDiff,
    intensityMismatches,
    maxIntensityDiff,
    scenarioMismatches,
    pathIdentityMismatches: 0,
    monthIdentityMismatches: 0,
    runIdMismatch: decodedBinary.runId === projection.run.runId ? 0 : 1
  };

  return { projection, currentJson, compactProjection, binaryFull, binaryReturns, results, exactness };
}

function makeBenchServer(dataSet, port) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const type = url.pathname.replace('/', '');
    const variant = url.searchParams.get('variant') || 'raw';
    const payload = dataSet[type];
    if (!payload) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }

    let body = payload;
    let contentType = 'application/json';
    if (type === 'binary-full' || type === 'binary-returns') {
      contentType = 'application/octet-stream';
    }

    if (variant === 'gzip') {
      body = zlib.gzipSync(payload);
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Content-Type', contentType);
      res.end(body);
      return;
    }

    if (variant === 'br') {
      body = zlib.brotliCompressSync(payload);
      res.setHeader('Content-Encoding', 'br');
      res.setHeader('Content-Type', contentType);
      res.end(body);
      return;
    }

    res.setHeader('Content-Type', contentType);
    res.end(body);
  });

  return new Promise((resolve) => {
    server.listen(port, () => resolve(server));
  });
}

function requestRaw(url) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    http.get(url, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const total = Buffer.concat(chunks);
        const elapsed = performance.now() - start;
        resolve({ elapsedMs: elapsed, buffer: total, headers: res.headers, statusCode: res.statusCode });
      });
    }).on('error', reject);
  });
}

async function benchmarkLocalhost(dataSet) {
  const server = await makeBenchServer(dataSet, BENCH_PORT);
  const endpoints = [
    'current-json',
    'compact-json',
    'binary-full',
    'binary-returns'
  ];
  const results = {};

  for (const endpoint of endpoints) {
    const rawSamples = [];
    const gzipSamples = [];
    const brotliSamples = [];

    for (let i = 0; i < LOCALHOST_ITERATIONS; i += 1) {
      const rawResponse = await requestRaw(`http://localhost:${BENCH_PORT}/${endpoint}`);
      rawSamples.push(rawResponse.elapsedMs);

      const compressedResponse = await requestRaw(`http://localhost:${BENCH_PORT}/${endpoint}?variant=gzip`);
      gzipSamples.push(compressedResponse.elapsedMs);

      const brotliResponse = await requestRaw(`http://localhost:${BENCH_PORT}/${endpoint}?variant=br`);
      brotliSamples.push(brotliResponse.elapsedMs);
    }

    results[endpoint] = {
      raw: stats(rawSamples),
      gzip: stats(gzipSamples),
      brotli: stats(brotliSamples)
    };
  }

  await new Promise((resolve) => server.close(resolve));
  return results;
}

async function compressionBench(dataSet) {
  const keys = Object.keys(dataSet);
  const result = {};
  for (const key of keys) {
    const payload = dataSet[key];
    const gzipSamples = [];
    const gunzipSamples = [];
    const brotliSamples = [];
    const unbrotliSamples = [];
    for (let i = 0; i < COMPRESSION_ITERATIONS; i += 1) {
      const gzipStart = performance.now();
      const gzipPayload = zlib.gzipSync(payload);
      gzipSamples.push(performance.now() - gzipStart);
      const gunzipStart = performance.now();
      zlib.gunzipSync(gzipPayload);
      gunzipSamples.push(performance.now() - gunzipStart);

      const brotliStart = performance.now();
      const brotliPayload = zlib.brotliCompressSync(payload);
      brotliSamples.push(performance.now() - brotliStart);
      const unbrotliStart = performance.now();
      zlib.brotliDecompressSync(brotliPayload);
      unbrotliSamples.push(performance.now() - unbrotliStart);
    }
    result[key] = {
      gzipBytes: zlib.gzipSync(payload).length,
      gzipMiB: byteMiB(zlib.gzipSync(payload).length),
      gzipMedianMs: median(gzipSamples),
      gunzipMedianMs: median(gunzipSamples),
      brotliBytes: zlib.brotliCompressSync(payload).length,
      brotliMiB: byteMiB(zlib.brotliCompressSync(payload).length),
      brotliMedianMs: median(brotliSamples),
      unbrotliMedianMs: median(unbrotliSamples)
    };
  }
  return result;
}

async function measureMemory(dataSet) {
  const result = {};
  for (const [key, payload] of Object.entries(dataSet)) {
    const before = process.memoryUsage();
    const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
    const decoded = typeof payload === 'string' ? data : data;
    const after = process.memoryUsage();
    result[key] = {
      heapDelta: after.heapUsed - before.heapUsed,
      externalDelta: after.external - before.external,
      arrayBuffersDelta: after.arrayBuffers - before.arrayBuffers
    };
  }
  return result;
}

(async () => {
  const projection = await getSoniaProjection();
  const compactProjection = makeCompactProjection(projection);
  const binaryFull = makeBinaryFull(projection);
  const binaryReturns = makeBinaryReturnsOnly(projection);
  const currentJson = JSON.stringify(projection);
  const compactJson = JSON.stringify(compactProjection);
  const dataSet = {
    'current-json': Buffer.from(currentJson, 'utf8'),
    'compact-json': Buffer.from(compactJson, 'utf8'),
    'binary-full': Buffer.from(binaryFull.buffer),
    'binary-returns': Buffer.from(binaryReturns.buffer)
  };

  const encodeDecode = await benchmarkEncodeDecode();
  const comp = await compressionBench(dataSet);
  const localhost = await benchmarkLocalhost(dataSet);
  const memory = await measureMemory({
    currentJSON: currentJson,
    compactJSON: compactJson,
    binaryFull: binaryFull.buffer,
    binaryReturnsOnly: binaryReturns.buffer
  });

  const summary = {
    serializationSize: {
      currentJSON: {
        rawBytes: currentJson.length,
        rawMiB: byteMiB(currentJson.length),
        gzipMiB: byteMiB(zlib.gzipSync(Buffer.from(currentJson)).length),
        brotliMiB: byteMiB(zlib.brotliCompressSync(Buffer.from(currentJson)).length),
        encodeMedianMs: encodeDecode.results.currentJSON.encode.median,
        decodeMedianMs: encodeDecode.results.currentJSON.decode.median,
      },
      compactJSON: {
        rawBytes: compactJson.length,
        rawMiB: byteMiB(compactJson.length),
        gzipMiB: byteMiB(zlib.gzipSync(Buffer.from(compactJson)).length),
        brotliMiB: byteMiB(zlib.brotliCompressSync(Buffer.from(compactJson)).length),
        encodeMedianMs: encodeDecode.results.compactJSON.encode.median,
        decodeMedianMs: encodeDecode.results.compactJSON.decode.median,
      },
      binaryFull: {
        rawBytes: binaryFull.buffer.length,
        rawMiB: byteMiB(binaryFull.buffer.length),
        gzipMiB: byteMiB(zlib.gzipSync(binaryFull.buffer).length),
        brotliMiB: byteMiB(zlib.brotliCompressSync(binaryFull.buffer).length),
        encodeMedianMs: encodeDecode.results.binaryFull.encode.median,
        decodeMedianMs: encodeDecode.results.binaryFull.decode.median,
      },
      binaryReturnsOnly: {
        rawBytes: binaryReturns.buffer.length,
        rawMiB: byteMiB(binaryReturns.buffer.length),
        gzipMiB: byteMiB(zlib.gzipSync(binaryReturns.buffer).length),
        brotliMiB: byteMiB(zlib.brotliCompressSync(binaryReturns.buffer).length),
        encodeMedianMs: encodeDecode.results.binaryReturnsOnly.encode.median,
        decodeMedianMs: encodeDecode.results.binaryReturnsOnly.decode.median,
      }
    },
    localhost: localhost,
    compression: comp,
    memory,
    exactness: encodeDecode.exactness,
    notes: {
      currentHttpCompressionEnabled: false,
      reason: 'No compression middleware mounted in Express server source',
      rawTransportMedianMs: {
        currentJSON: localhost['current-json'].raw.median,
        compactJSON: localhost['compact-json'].raw.median,
        binaryFull: localhost['binary-full'].raw.median,
        binaryReturnsOnly: localhost['binary-returns'].raw.median,
      }
    }
  };

  console.log(JSON.stringify(summary, null, 2));
})();
