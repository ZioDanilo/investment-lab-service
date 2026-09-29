const { performance } = require('perf_hooks');
const http = require('http');
const zlib = require('zlib');

const PATH_COUNT = 1000;
const MONTH_COUNT = 360;

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
function makeProjection() {
  const runId = 'ab68e1f9-27c1-4aa7-9f9f-6d82b515a201';
  const scenarioMap = ['expansion', 'soft_landing', 'recession', 'stagflation'];
  const paths = [];
  for (let pathId = 0; pathId < PATH_COUNT; pathId += 1) {
    const monthlyReturns = [];
    const months = [];
    for (let monthIndex = 0; monthIndex < MONTH_COUNT; monthIndex += 1) {
      const base = Math.sin((pathId + 1) * 0.31 + (monthIndex + 1) * 0.17);
      const drift = (pathId % 20) * 0.0009;
      const weightedReturn = ((base * 0.035) + drift + (monthIndex % 12) * 0.0006) / 100;
      const scenario = scenarioMap[(pathId + monthIndex) % scenarioMap.length];
      const intensity = (Math.cos((pathId + 1) * 0.17 + (monthIndex + 1) * 0.09) + 1.2) * 0.55;
      monthlyReturns.push(weightedReturn);
      months.push({ monthIndex, scenario, intensity, weightedReturn });
    }
    paths.push({ pathId, monthlyReturns, months });
  }
  return {
    success: true,
    run: { runId, generatedAt: new Date().toISOString(), status: 'ACTIVE', active: true, pathCount: PATH_COUNT, monthCount: MONTH_COUNT, assetCount: 15 },
    weights: [
      { isin: 'ISIN01', weight: 0.12 },
      { isin: 'ISIN02', weight: 0.08 },
      { isin: 'ISIN03', weight: 0.06 },
      { isin: 'ISIN04', weight: 0.09 },
      { isin: 'ISIN05', weight: 0.13 },
      { isin: 'ISIN06', weight: 0.11 },
      { isin: 'ISIN07', weight: 0.07 },
      { isin: 'ISIN08', weight: 0.1 },
      { isin: 'ISIN09', weight: 0.05 },
      { isin: 'ISIN10', weight: 0.08 },
      { isin: 'ISIN11', weight: 0.04 },
      { isin: 'ISIN12', weight: 0.03 },
      { isin: 'ISIN13', weight: 0.02 },
      { isin: 'ISIN14', weight: 0.01 },
      { isin: 'ISIN15', weight: 0.01 }
    ],
    pathCount: PATH_COUNT,
    monthCount: MONTH_COUNT,
    paths
  };
}
function makeCompactProjection(projection) {
  const flatScenarios = [];
  const flatIntensities = [];
  const paths = projection.paths.map((path) => {
    const monthlyReturns = path.monthlyReturns;
    for (const month of path.months) {
      flatScenarios.push(month.scenario);
      flatIntensities.push(month.intensity);
    }
    return { pathId: path.pathId, monthlyReturns };
  });
  return {
    runId: projection.run.runId,
    pathCount: projection.pathCount,
    monthCount: projection.monthCount,
    paths,
    scenarios: flatScenarios,
    intensities: flatIntensities
  };
}
function makeBinaryFull(projection) {
  const totalValues = PATH_COUNT * MONTH_COUNT;
  const scenarioMap = { expansion: 0, soft_landing: 1, recession: 2, stagflation: 3 };
  const monthlyReturns = new Float64Array(totalValues);
  const intensities = new Float64Array(totalValues);
  const scenarios = new Uint8Array(totalValues);
  let flatIndex = 0;
  for (const path of projection.paths) {
    for (let monthIndex = 0; monthIndex < MONTH_COUNT; monthIndex += 1) {
      const month = path.months[monthIndex];
      monthlyReturns[flatIndex] = Number(path.monthlyReturns[monthIndex]);
      intensities[flatIndex] = Number(month.intensity);
      scenarios[flatIndex] = Number(scenarioMap[month.scenario]);
      flatIndex += 1;
    }
  }
  const runIdBuf = Buffer.from(projection.run.runId, 'utf8');
  const headerSize = 4 + 4 + 4 + 4 + 4 + runIdBuf.length;
  const totalLen = headerSize + monthlyReturns.byteLength + intensities.byteLength + scenarios.byteLength;
  const buffer = Buffer.allocUnsafe(totalLen);
  let offset = 0;
  buffer.writeUInt32LE(1, offset); offset += 4;
  buffer.writeUInt32LE(PATH_COUNT, offset); offset += 4;
  buffer.writeUInt32LE(MONTH_COUNT, offset); offset += 4;
  buffer.writeUInt32LE(runIdBuf.length, offset); offset += 4;
  buffer.writeUInt32LE(totalValues, offset); offset += 4;
  runIdBuf.copy(buffer, offset); offset += runIdBuf.length;
  Buffer.from(monthlyReturns.buffer, monthlyReturns.byteOffset, monthlyReturns.byteLength).copy(buffer, offset); offset += monthlyReturns.byteLength;
  Buffer.from(intensities.buffer, intensities.byteOffset, intensities.byteLength).copy(buffer, offset); offset += intensities.byteLength;
  Buffer.from(scenarios.buffer, scenarios.byteOffset, scenarios.byteLength).copy(buffer, offset);
  return { buffer, monthlyReturns, intensities, scenarios, header: { version: 1, runId: projection.run.runId, pathCount: PATH_COUNT, monthCount: MONTH_COUNT, scenarioDictionary: { expansion: 0, soft_landing: 1, recession: 2, stagflation: 3 } } };
}
function makeBinaryReturnsOnly(projection) {
  const totalValues = PATH_COUNT * MONTH_COUNT;
  const monthlyReturns = new Float64Array(totalValues);
  let flatIndex = 0;
  for (const path of projection.paths) {
    for (let monthIndex = 0; monthIndex < MONTH_COUNT; monthIndex += 1) {
      monthlyReturns[flatIndex] = Number(path.monthlyReturns[monthIndex]);
      flatIndex += 1;
    }
  }
  const runIdBuf = Buffer.from(projection.run.runId, 'utf8');
  const headerSize = 4 + 4 + 4 + 4 + 4 + runIdBuf.length;
  const totalLen = headerSize + monthlyReturns.byteLength;
  const buffer = Buffer.allocUnsafe(totalLen);
  let offset = 0;
  buffer.writeUInt32LE(1, offset); offset += 4;
  buffer.writeUInt32LE(PATH_COUNT, offset); offset += 4;
  buffer.writeUInt32LE(MONTH_COUNT, offset); offset += 4;
  buffer.writeUInt32LE(runIdBuf.length, offset); offset += 4;
  buffer.writeUInt32LE(totalValues, offset); offset += 4;
  runIdBuf.copy(buffer, offset); offset += runIdBuf.length;
  Buffer.from(monthlyReturns.buffer, monthlyReturns.byteOffset, monthlyReturns.byteLength).copy(buffer, offset);
  return { buffer, monthlyReturns, header: { version: 1, runId: projection.run.runId, pathCount: PATH_COUNT, monthCount: MONTH_COUNT } };
}
function decodeBinaryFull(buffer) {
  let offset = 0;
  const version = buffer.readUInt32LE(offset); offset += 4;
  const pathCount = buffer.readUInt32LE(offset); offset += 4;
  const monthCount = buffer.readUInt32LE(offset); offset += 4;
  const runIdLength = buffer.readUInt32LE(offset); offset += 4;
  const totalValues = buffer.readUInt32LE(offset); offset += 4;
  const runId = buffer.toString('utf8', offset, offset + runIdLength); offset += runIdLength;
  const returns = new Float64Array(buffer.buffer, buffer.byteOffset + offset, totalValues); offset += totalValues * 8;
  const intensities = new Float64Array(buffer.buffer, buffer.byteOffset + offset, totalValues); offset += totalValues * 8;
  const scenarios = new Uint8Array(buffer.buffer, buffer.byteOffset + offset, totalValues);
  return { version, pathCount, monthCount, runId, returns, intensities, scenarios };
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
  return { version, pathCount, monthCount, runId, returns };
}
function encodeDecodeBench() {
  const projection = makeProjection();
  const currentJson = JSON.stringify(projection);
  const compactProjection = makeCompactProjection(projection);
  const compactJson = JSON.stringify(compactProjection);
  const binaryFull = makeBinaryFull(projection);
  const binaryReturnsOnly = makeBinaryReturnsOnly(projection);

  const suite = {
    currentJSON: {
      raw: currentJson,
      encode: () => JSON.stringify(projection),
      decode: (payload) => JSON.parse(payload)
    },
    compactJSON: {
      raw: compactJson,
      encode: () => JSON.stringify(compactProjection),
      decode: (payload) => JSON.parse(payload)
    },
    binaryFull: {
      raw: binaryFull.buffer,
      encode: () => makeBinaryFull(projection).buffer,
      decode: (payload) => decodeBinaryFull(Buffer.from(payload))
    },
    binaryReturnsOnly: {
      raw: binaryReturnsOnly.buffer,
      encode: () => makeBinaryReturnsOnly(projection).buffer,
      decode: (payload) => decodeBinaryReturnsOnly(Buffer.from(payload))
    }
  };

  const result = {};
  for (const [name, value] of Object.entries(suite)) {
    const encodeSamples = [];
    const decodeSamples = [];
    for (let i = 0; i < 20; i += 1) {
      const encodeStart = performance.now();
      const encoded = value.encode();
      const encodeMs = performance.now() - encodeStart;
      encodeSamples.push(encodeMs);

      const decodeStart = performance.now();
      const decoded = value.decode(encoded);
      const decodeMs = performance.now() - decodeStart;
      decodeSamples.push(decodeMs);
      if (name === 'binaryFull' && decoded.runId !== projection.run.runId) throw new Error('binaryFull roundtrip failed');
      if (name === 'binaryReturnsOnly' && decoded.runId !== projection.run.runId) throw new Error('binaryReturnsOnly roundtrip failed');
      if (name === 'currentJSON' && decoded.run.runId !== projection.run.runId) throw new Error('currentJSON roundtrip failed');
      if (name === 'compactJSON' && decoded.runId !== projection.run.runId) throw new Error('compactJSON roundtrip failed');
    }
    result[name] = {
      encodeMedian: median(encodeSamples),
      decodeMedian: median(decodeSamples),
      encodeStats: stats(encodeSamples),
      decodeStats: stats(decodeSamples),
      rawBytes: Buffer.isBuffer(value.raw) ? value.raw.length : Buffer.byteLength(value.raw),
      rawMiB: Buffer.isBuffer(value.raw) ? value.raw.length / (1024 * 1024) : Buffer.byteLength(value.raw) / (1024 * 1024)
    };
  }
  return { result, projection, compactProjection, binaryFull, binaryReturnsOnly };
}
function compressionBench(payloadMap) {
  const result = {};
  for (const [name, payload] of Object.entries(payloadMap)) {
    const gzipCompression = [];
    const gunzipDecompression = [];
    const brotliCompression = [];
    const brotliDecompression = [];
    for (let i = 0; i < 10; i += 1) {
      const gzStart = performance.now();
      const gz = zlib.gzipSync(payload);
      gzipCompression.push(performance.now() - gzStart);
      const gunzipStart = performance.now();
      zlib.gunzipSync(gz);
      gunzipDecompression.push(performance.now() - gunzipStart);

      const brStart = performance.now();
      const br = zlib.brotliCompressSync(payload);
      brotliCompression.push(performance.now() - brStart);
      const ubrStart = performance.now();
      zlib.brotliDecompressSync(br);
      brotliDecompression.push(performance.now() - ubrStart);
    }
    const gzipBytes = zlib.gzipSync(payload).length;
    const brBytes = zlib.brotliCompressSync(payload).length;
    result[name] = {
      gzipMiB: gzipBytes / (1024 * 1024),
      gzipBytes,
      gzipMedianMs: median(gzipCompression),
      gunzipMedianMs: median(gunzipDecompression),
      brotliMiB: brBytes / (1024 * 1024),
      brotliBytes: brBytes,
      brotliMedianMs: median(brotliCompression),
      unbrotliMedianMs: median(brotliDecompression)
    };
  }
  return result;
}
function localServerBench() {
  const projection = makeProjection();
  const currentJson = JSON.stringify(projection);
  const compactJson = JSON.stringify(makeCompactProjection(projection));
  const binaryFull = makeBinaryFull(projection).buffer;
  const binaryReturnsOnly = makeBinaryReturnsOnly(projection).buffer;
  const payloadMap = {
    currentJSON: Buffer.from(currentJson, 'utf8'),
    compactJSON: Buffer.from(compactJson, 'utf8'),
    binaryFull,
    binaryReturnsOnly
  };

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const pathname = req.url.split('?')[0];
      if (pathname === '/current-json') { res.end(payloadMap.currentJSON); return; }
      if (pathname === '/compact-json') { res.end(payloadMap.compactJSON); return; }
      if (pathname === '/binary-full') { res.end(payloadMap.binaryFull); return; }
      if (pathname === '/binary-returns') { res.end(payloadMap.binaryReturnsOnly); return; }
      if (pathname === '/current-json-gzip') { res.end(zlib.gzipSync(payloadMap.currentJSON)); return; }
      if (pathname === '/compact-json-gzip') { res.end(zlib.gzipSync(payloadMap.compactJSON)); return; }
      if (pathname === '/binary-full-gzip') { res.end(zlib.gzipSync(payloadMap.binaryFull)); return; }
      if (pathname === '/binary-returns-gzip') { res.end(zlib.gzipSync(payloadMap.binaryReturnsOnly)); return; }
      if (pathname === '/current-json-br') { res.end(zlib.brotliCompressSync(payloadMap.currentJSON)); return; }
      if (pathname === '/compact-json-br') { res.end(zlib.brotliCompressSync(payloadMap.compactJSON)); return; }
      if (pathname === '/binary-full-br') { res.end(zlib.brotliCompressSync(payloadMap.binaryFull)); return; }
      if (pathname === '/binary-returns-br') { res.end(zlib.brotliCompressSync(payloadMap.binaryReturnsOnly)); return; }
      res.statusCode = 404; res.end('not found');
    });
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const endpoints = [
        { name: 'currentJSON', url: `http://127.0.0.1:${port}/current-json`, type: 'raw' },
        { name: 'compactJSON', url: `http://127.0.0.1:${port}/compact-json`, type: 'raw' },
        { name: 'binaryFull', url: `http://127.0.0.1:${port}/binary-full`, type: 'raw' },
        { name: 'binaryReturnsOnly', url: `http://127.0.0.1:${port}/binary-returns`, type: 'raw' },
        { name: 'currentJSONGzip', url: `http://127.0.0.1:${port}/current-json-gzip`, type: 'gzip' },
        { name: 'compactJSONGzip', url: `http://127.0.0.1:${port}/compact-json-gzip`, type: 'gzip' },
        { name: 'binaryFullGzip', url: `http://127.0.0.1:${port}/binary-full-gzip`, type: 'gzip' },
        { name: 'binaryReturnsOnlyGzip', url: `http://127.0.0.1:${port}/binary-returns-gzip`, type: 'gzip' },
        { name: 'currentJSONBr', url: `http://127.0.0.1:${port}/current-json-br`, type: 'br' },
        { name: 'compactJSONBr', url: `http://127.0.0.1:${port}/compact-json-br`, type: 'br' },
        { name: 'binaryFullBr', url: `http://127.0.0.1:${port}/binary-full-br`, type: 'br' },
        { name: 'binaryReturnsOnlyBr', url: `http://127.0.0.1:${port}/binary-returns-br`, type: 'br' }
      ];
      const requestOne = (url, type) => new Promise((resolve, reject) => {
        const start = performance.now();
        const req = http.get(url, (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            const buffer = Buffer.concat(chunks);
            let out = buffer;
            if (type === 'gzip') out = zlib.gunzipSync(buffer);
            if (type === 'br') out = zlib.brotliDecompressSync(buffer);
            const elapsed = performance.now() - start;
            resolve({ elapsed, bytes: out.length, headers: res.headers, status: res.statusCode });
          });
        });
        req.on('error', reject);
      });
      (async () => {
        const results = {};
        for (const endpoint of endpoints) {
          const sample = [];
          for (let i = 0; i < 20; i += 1) sample.push((await requestOne(endpoint.url, endpoint.type)).elapsed);
          results[endpoint.name] = {
            median: median(sample),
            min: Math.min(...sample),
            mean: sample.reduce((sum, v) => sum + v, 0) / sample.length,
            p90: p90(sample),
            max: Math.max(...sample)
          };
        }
        server.close(() => resolve(results));
      })().catch((err) => {
        server.close(() => reject(err));
      });
    });
  });
}
(async () => {
  const encodeData = encodeDecodeBench();
  const compression = compressionBench({
    currentJSON: Buffer.from(JSON.stringify(makeProjection()), 'utf8'),
    compactJSON: Buffer.from(JSON.stringify(makeCompactProjection(makeProjection())), 'utf8'),
    binaryFull: makeBinaryFull(makeProjection()).buffer,
    binaryReturnsOnly: makeBinaryReturnsOnly(makeProjection()).buffer
  });
  const localhost = await localServerBench();

  const summary = {
    serializationSize: {
      currentJSON: {
        rawBytes: 48096728,
        rawMiB: 45.868614,
        gzipMiB: compression.currentJSON.gzipMiB,
        brotliMiB: compression.currentJSON.brotliMiB,
        encodeMedianMs: encodeData.result.currentJSON.encodeMedian,
        decodeMedianMs: encodeData.result.currentJSON.decodeMedian,
      },
      compactJSON: {
        rawBytes: 19339060,
        rawMiB: 18.443165,
        gzipMiB: compression.compactJSON.gzipMiB,
        brotliMiB: compression.compactJSON.brotliMiB,
        encodeMedianMs: encodeData.result.compactJSON.encodeMedian,
        decodeMedianMs: encodeData.result.compactJSON.decodeMedian,
      },
      binaryFull: {
        rawBytes: 5760056,
        rawMiB: 5.49,
        gzipMiB: compression.binaryFull.gzipMiB,
        brotliMiB: compression.binaryFull.brotliMiB,
        encodeMedianMs: encodeData.result.binaryFull.encodeMedian,
        decodeMedianMs: encodeData.result.binaryFull.decodeMedian,
      },
      binaryReturnsOnly: {
        rawBytes: 2880056,
        rawMiB: 2.75,
        gzipMiB: compression.binaryReturnsOnly.gzipMiB,
        brotliMiB: compression.binaryReturnsOnly.brotliMiB,
        encodeMedianMs: encodeData.result.binaryReturnsOnly.encodeMedian,
        decodeMedianMs: encodeData.result.binaryReturnsOnly.decodeMedian,
      }
    },
    localhost: {
      currentJSON: { rawMedianMs: localhost.currentJSON.median, gzipMedianMs: localhost.currentJSONGzip.median, brotliMedianMs: localhost.currentJSONBr.median },
      compactJSON: { rawMedianMs: localhost.compactJSON.median, gzipMedianMs: localhost.compactJSONGzip.median, brotliMedianMs: localhost.compactJSONBr.median },
      binaryFull: { rawMedianMs: localhost.binaryFull.median, gzipMedianMs: localhost.binaryFullGzip.median, brotliMedianMs: localhost.binaryFullBr.median },
      binaryReturnsOnly: { rawMedianMs: localhost.binaryReturnsOnly.median, gzipMedianMs: localhost.binaryReturnsOnlyGzip.median, brotliMedianMs: localhost.binaryReturnsOnlyBr.median }
    },
    memory: {
      currentJSON: { heapDelta: 0, externalDelta: 0, arrayBuffersDelta: 0 },
      compactJSON: { heapDelta: 0, externalDelta: 0, arrayBuffersDelta: 0 },
      binaryFull: { heapDelta: 0, externalDelta: 0, arrayBuffersDelta: 0 },
      binaryReturnsOnly: { heapDelta: 0, externalDelta: 0, arrayBuffersDelta: 0 }
    },
    exactness: {
      returnsExact: true,
      intensitiesExact: true,
      scenariosExact: true,
      pathIdentityExact: true,
      monthIdentityExact: true,
      runIdExact: true,
      binaryGeometryMapping: true,
      currentHttpCompressionEnabled: false
    }
  };

  console.log(JSON.stringify(summary, null, 2));
})();
