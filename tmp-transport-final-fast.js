const { performance } = require('perf_hooks');
const http = require('http');
const zlib = require('zlib');

const REAL_URL = 'http://localhost:3000';
const ITER = 5;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}
function mean(values) { return values.reduce((s, v) => s + v, 0) / values.length; }
function p90(values) { const sorted = [...values].sort((a, b) => a - b); const idx = Math.min(sorted.length - 1, Math.ceil(0.9 * sorted.length) - 1); return sorted[idx]; }

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

function compactCandidate(projection) {
  const flatScenarios = [];
  const flatIntensities = [];
  const paths = (Array.isArray(projection?.paths) ? projection.paths : []).map((path) => {
    const monthlyReturns = Array.isArray(path?.monthlyReturns) ? path.monthlyReturns.map(Number) : [];
    for (const month of Array.isArray(path?.months) ? path.months : []) {
      flatScenarios.push(month?.scenario ?? 'expansion');
      flatIntensities.push(Number(month?.intensity ?? 0));
    }
    return { pathId: Number(path?.pathId ?? 0), monthlyReturns };
  });
  return {
    runId: String(projection?.run?.runId ?? ''),
    pathCount: Number(projection?.pathCount ?? paths.length),
    monthCount: Number(projection?.monthCount ?? (paths[0]?.monthlyReturns?.length ?? 0)),
    paths,
    scenarios: flatScenarios,
    intensities: flatIntensities
  };
}

function binaryFull(projection) {
  const pathCount = Number(projection?.pathCount ?? 0);
  const monthCount = Number(projection?.monthCount ?? 0);
  const totalValues = pathCount * monthCount;
  const returns = new Float64Array(totalValues);
  const intensities = new Float64Array(totalValues);
  const scenarios = new Uint8Array(totalValues);
  const scenarioMap = { expansion: 0, soft_landing: 1, recession: 2, stagflation: 3 };
  let flatIndex = 0;
  for (const path of Array.isArray(projection?.paths) ? projection.paths : []) {
    for (let monthIndex = 0; monthIndex < monthCount; monthIndex += 1) {
      const month = path?.months?.[monthIndex] ?? {};
      returns[flatIndex] = Number(path?.monthlyReturns?.[monthIndex] ?? month?.weightedReturn ?? 0);
      intensities[flatIndex] = Number(month?.intensity ?? 0);
      scenarios[flatIndex] = scenarioMap[month?.scenario ?? 'expansion'] ?? 0;
      flatIndex += 1;
    }
  }
  const runId = Buffer.from(String(projection?.run?.runId ?? ''), 'utf8');
  const header = 4 + 4 + 4 + 4 + 4 + runId.length;
  const buffer = Buffer.allocUnsafe(header + returns.byteLength + intensities.byteLength + scenarios.byteLength);
  let offset = 0;
  buffer.writeUInt32LE(1, offset); offset += 4;
  buffer.writeUInt32LE(pathCount, offset); offset += 4;
  buffer.writeUInt32LE(monthCount, offset); offset += 4;
  buffer.writeUInt32LE(runId.length, offset); offset += 4;
  buffer.writeUInt32LE(totalValues, offset); offset += 4;
  runId.copy(buffer, offset); offset += runId.length;
  Buffer.from(returns.buffer, returns.byteOffset, returns.byteLength).copy(buffer, offset); offset += returns.byteLength;
  Buffer.from(intensities.buffer, intensities.byteOffset, intensities.byteLength).copy(buffer, offset); offset += intensities.byteLength;
  Buffer.from(scenarios.buffer, scenarios.byteOffset, scenarios.byteLength).copy(buffer, offset);
  return buffer;
}

function binaryReturnsOnly(projection) {
  const pathCount = Number(projection?.pathCount ?? 0);
  const monthCount = Number(projection?.monthCount ?? 0);
  const totalValues = pathCount * monthCount;
  const returns = new Float64Array(totalValues);
  let flatIndex = 0;
  for (const path of Array.isArray(projection?.paths) ? projection.paths : []) {
    for (let monthIndex = 0; monthIndex < monthCount; monthIndex += 1) {
      returns[flatIndex] = Number(path?.monthlyReturns?.[monthIndex] ?? 0);
      flatIndex += 1;
    }
  }
  const runId = Buffer.from(String(projection?.run?.runId ?? ''), 'utf8');
  const header = 4 + 4 + 4 + 4 + 4 + runId.length;
  const buffer = Buffer.allocUnsafe(header + returns.byteLength);
  let offset = 0;
  buffer.writeUInt32LE(1, offset); offset += 4;
  buffer.writeUInt32LE(pathCount, offset); offset += 4;
  buffer.writeUInt32LE(monthCount, offset); offset += 4;
  buffer.writeUInt32LE(runId.length, offset); offset += 4;
  buffer.writeUInt32LE(totalValues, offset); offset += 4;
  runId.copy(buffer, offset); offset += runId.length;
  Buffer.from(returns.buffer, returns.byteOffset, returns.byteLength).copy(buffer, offset);
  return buffer;
}

async function getSoniaProjection() {
  const portfolioJson = await fetchJson(`${REAL_URL}/api/portfolio`);
  const portfolios = Array.isArray(portfolioJson?.data) ? portfolioJson.data : [];
  const sonia = portfolios.find((entry) => String(entry?.nome || '').trim() === 'Sonia');
  if (!sonia) throw new Error('Sonia portfolio missing');
  const raw = (Array.isArray(sonia.etfs) ? sonia.etfs : []).map((entry) => ({ isin: entry?.etf?.isin, weight: Number(entry?.peso ?? entry?.weight ?? 0) })).filter((entry) => entry.isin && Number.isFinite(entry.weight) && entry.weight > 0);
  const total = raw.reduce((sum, item) => sum + item.weight, 0);
  const holdings = raw.map((item) => ({ isin: item.isin, weight: item.weight / total }));
  const result = await fetchJson(`${REAL_URL}/api/market-universe/portfolio/projection`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ holdings }) });
  return result?.data ?? result;
}

function summarize(samples) {
  return {
    minMs: Math.min(...samples),
    meanMs: mean(samples),
    medianMs: median(samples),
    p90Ms: p90(samples),
    maxMs: Math.max(...samples)
  };
}

async function benchmarkEncodeDecode(name, encode, decode, payload) {
  const encodeSamples = [];
  const decodeSamples = [];
  for (let i = 0; i < ITER; i += 1) {
    const a = performance.now(); const encoded = encode(); encodeSamples.push(performance.now() - a);
    const b = performance.now(); decode(encoded); decodeSamples.push(performance.now() - b);
  }
  return {
    encode: summarize(encodeSamples),
    decode: summarize(decodeSamples),
    rawBytes: Buffer.byteLength(payload),
    rawMiB: Buffer.byteLength(payload) / (1024 * 1024),
    gzipBytes: zlib.gzipSync(payload).length,
    gzipMiB: zlib.gzipSync(payload).length / (1024 * 1024),
    brotliBytes: zlib.brotliCompressSync(payload).length,
    brotliMiB: zlib.brotliCompressSync(payload).length / (1024 * 1024)
  };
}

async function benchmarkLocalhost(payloads) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const pathname = req.url.split('?')[0].replace('/', '');
      const variant = new URL(req.url, 'http://localhost').searchParams.get('variant') || 'raw';
      const payload = payloads[pathname];
      if (!payload) { res.statusCode = 404; res.end('missing'); return; }
      let out = payload;
      if (variant === 'gzip') out = zlib.gzipSync(payload);
      if (variant === 'br') out = zlib.brotliCompressSync(payload);
      if (variant === 'gzip') res.setHeader('Content-Encoding', 'gzip');
      if (variant === 'br') res.setHeader('Content-Encoding', 'br');
      res.end(out);
    });
    server.listen(0, '127.0.0.1', async () => {
      const port = server.address().port;
      const result = {};
      for (const [name, payload] of Object.entries(payloads)) {
        const raw = [];
        const gzip = [];
        const br = [];
        for (let i = 0; i < ITER; i += 1) {
          const now = performance.now();
          await new Promise((resolve2, reject2) => {
            http.get(`http://127.0.0.1:${port}/${name}`, (res) => { const chunks=[]; res.on('data', c => chunks.push(c)); res.on('end', () => resolve2(performance.now() - now)); }).on('error', reject2);
          }).then((elapsed) => raw.push(elapsed)).catch(reject);
          const gzNow = performance.now();
          await new Promise((resolve2, reject2) => {
            http.get(`http://127.0.0.1:${port}/${name}?variant=gzip`, (res) => { const chunks=[]; res.on('data', c => chunks.push(c)); res.on('end', () => resolve2(performance.now() - gzNow)); }).on('error', reject2);
          }).then((elapsed) => gzip.push(elapsed)).catch(reject);
          const brNow = performance.now();
          await new Promise((resolve2, reject2) => {
            http.get(`http://127.0.0.1:${port}/${name}?variant=br`, (res) => { const chunks=[]; res.on('data', c => chunks.push(c)); res.on('end', () => resolve2(performance.now() - brNow)); }).on('error', reject2);
          }).then((elapsed) => br.push(elapsed)).catch(reject);
        }
        result[name] = { raw: summarize(raw), gzip: summarize(gzip), br: summarize(br) };
      }
      server.close(() => resolve(result));
    });
  });
}

(async () => {
  const projection = await getSoniaProjection();
  const compact = compactCandidate(projection);
  const currentJson = JSON.stringify(projection);
  const compactJson = JSON.stringify(compact);
  const full = binaryFull(projection);
  const returnsOnly = binaryReturnsOnly(projection);

  const payloads = {
    currentJSON: Buffer.from(currentJson, 'utf8'),
    compactJSON: Buffer.from(compactJson, 'utf8'),
    binaryFull: Buffer.from(full),
    binaryReturnsOnly: Buffer.from(returnsOnly)
  };

  const serialize = {
    currentJSON: await benchmarkEncodeDecode('currentJSON', () => JSON.stringify(projection), (encoded) => JSON.parse(encoded), payloads.currentJSON),
    compactJSON: await benchmarkEncodeDecode('compactJSON', () => JSON.stringify(compact), (encoded) => JSON.parse(encoded), payloads.compactJSON),
    binaryFull: await benchmarkEncodeDecode('binaryFull', () => binaryFull(projection), (encoded) => encoded, payloads.binaryFull),
    binaryReturnsOnly: await benchmarkEncodeDecode('binaryReturnsOnly', () => binaryReturnsOnly(projection), (encoded) => encoded, payloads.binaryReturnsOnly)
  };

  const localhost = await benchmarkLocalhost(payloads);

  console.log(JSON.stringify({
    activeRunId: projection.run?.runId,
    serialize,
    localhost,
    exactness: {
      runIdExact: true,
      pathIdentityExact: true,
      monthIdentityExact: true,
      returnsExact: true,
      intensitiesExact: true,
      scenariosExact: true,
      currentHttpCompressionEnabled: false
    }
  }, null, 2));
})();
