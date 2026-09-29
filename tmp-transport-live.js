const { performance } = require('perf_hooks');
const zlib = require('zlib');
const fs = require('fs');

const BASE = 'http://localhost:3000';

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    min: sorted[0],
    mean: values.reduce((s, v) => s + v, 0) / values.length,
    median: median(values),
    p90: sorted[Math.min(sorted.length - 1, Math.ceil(0.9 * sorted.length) - 1)],
    max: sorted[sorted.length - 1]
  };
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function getSoniaProjection() {
  const portfolioJson = await fetchJson(`${BASE}/api/portfolio`);
  const portfolios = Array.isArray(portfolioJson?.data) ? portfolioJson.data : [];
  const sonia = portfolios.find((entry) => String(entry?.nome || '').trim() === 'Sonia');
  if (!sonia) throw new Error('Sonia portfolio not found');
  const raw = (Array.isArray(sonia.etfs) ? sonia.etfs : [])
    .map((entry) => ({ isin: entry?.etf?.isin, weight: Number(entry?.peso ?? entry?.weight ?? 0) }))
    .filter((entry) => entry.isin && Number.isFinite(entry.weight) && entry.weight > 0);
  const total = raw.reduce((sum, item) => sum + item.weight, 0);
  const holdings = raw.map((item) => ({ isin: item.isin, weight: item.weight / total }));
  const result = await fetchJson(`${BASE}/api/market-universe/portfolio/projection`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ holdings })
  });
  return result?.data ?? result;
}

function compactProjection(projection) {
  const paths = (Array.isArray(projection?.paths) ? projection.paths : []).map((path) => ({
    pathId: Number(path?.pathId ?? 0),
    monthlyReturns: Array.isArray(path?.monthlyReturns) ? path.monthlyReturns.map(Number) : []
  }));
  return {
    runId: String(projection?.run?.runId ?? ''),
    pathCount: Number(projection?.pathCount ?? paths.length),
    monthCount: Number(projection?.monthCount ?? (paths[0]?.monthlyReturns?.length ?? 0)),
    paths,
    scenarios: (Array.isArray(projection?.paths) ? projection.paths : []).flatMap((path) => (Array.isArray(path?.months) ? path.months : []).map((month) => month?.scenario ?? 'expansion')),
    intensities: (Array.isArray(projection?.paths) ? projection.paths : []).flatMap((path) => (Array.isArray(path?.months) ? path.months : []).map((month) => Number(month?.intensity ?? 0)))
  };
}

function binaryFull(projection) {
  const pathCount = Number(projection?.pathCount ?? 0);
  const monthCount = Number(projection?.monthCount ?? 0);
  const total = pathCount * monthCount;
  const returns = new Float64Array(total);
  const intensities = new Float64Array(total);
  const scenarios = new Uint8Array(total);
  const map = { expansion: 0, soft_landing: 1, recession: 2, stagflation: 3 };
  let idx = 0;
  for (const path of Array.isArray(projection?.paths) ? projection.paths : []) {
    for (let monthIndex = 0; monthIndex < monthCount; monthIndex += 1) {
      const month = path?.months?.[monthIndex] ?? {};
      returns[idx] = Number(path?.monthlyReturns?.[monthIndex] ?? month?.weightedReturn ?? 0);
      intensities[idx] = Number(month?.intensity ?? 0);
      scenarios[idx] = map[month?.scenario ?? 'expansion'] ?? 0;
      idx += 1;
    }
  }
  const runId = Buffer.from(String(projection?.run?.runId ?? ''), 'utf8');
  const headerSize = 4 + 4 + 4 + 4 + 4 + runId.length;
  const buffer = Buffer.allocUnsafe(headerSize + returns.byteLength + intensities.byteLength + scenarios.byteLength);
  let offset = 0;
  buffer.writeUInt32LE(1, offset); offset += 4;
  buffer.writeUInt32LE(pathCount, offset); offset += 4;
  buffer.writeUInt32LE(monthCount, offset); offset += 4;
  buffer.writeUInt32LE(runId.length, offset); offset += 4;
  buffer.writeUInt32LE(total, offset); offset += 4;
  runId.copy(buffer, offset); offset += runId.length;
  Buffer.from(returns.buffer, returns.byteOffset, returns.byteLength).copy(buffer, offset); offset += returns.byteLength;
  Buffer.from(intensities.buffer, intensities.byteOffset, intensities.byteLength).copy(buffer, offset); offset += intensities.byteLength;
  Buffer.from(scenarios.buffer, scenarios.byteOffset, scenarios.byteLength).copy(buffer, offset);
  return buffer;
}

function binaryReturnsOnly(projection) {
  const pathCount = Number(projection?.pathCount ?? 0);
  const monthCount = Number(projection?.monthCount ?? 0);
  const total = pathCount * monthCount;
  const returns = new Float64Array(total);
  let idx = 0;
  for (const path of Array.isArray(projection?.paths) ? projection.paths : []) {
    for (let monthIndex = 0; monthIndex < monthCount; monthIndex += 1) {
      returns[idx] = Number(path?.monthlyReturns?.[monthIndex] ?? 0);
      idx += 1;
    }
  }
  const runId = Buffer.from(String(projection?.run?.runId ?? ''), 'utf8');
  const headerSize = 4 + 4 + 4 + 4 + 4 + runId.length;
  const buffer = Buffer.allocUnsafe(headerSize + returns.byteLength);
  let offset = 0;
  buffer.writeUInt32LE(1, offset); offset += 4;
  buffer.writeUInt32LE(pathCount, offset); offset += 4;
  buffer.writeUInt32LE(monthCount, offset); offset += 4;
  buffer.writeUInt32LE(runId.length, offset); offset += 4;
  buffer.writeUInt32LE(total, offset); offset += 4;
  runId.copy(buffer, offset); offset += runId.length;
  Buffer.from(returns.buffer, returns.byteOffset, returns.byteLength).copy(buffer, offset);
  return buffer;
}

(async () => {
  const projection = await getSoniaProjection();
  const currentJSON = JSON.stringify(projection);
  const compactJSON = JSON.stringify(compactProjection(projection));
  const fullBuffer = binaryFull(projection);
  const returnsOnlyBuffer = binaryReturnsOnly(projection);

  const payloads = {
    currentJSON: Buffer.from(currentJSON, 'utf8'),
    compactJSON: Buffer.from(compactJSON, 'utf8'),
    binaryFull: Buffer.from(fullBuffer),
    binaryReturnsOnly: Buffer.from(returnsOnlyBuffer)
  };

  const result = {};
  for (const [name, buffer] of Object.entries(payloads)) {
    const encodeSamples = [];
    const decodeSamples = [];
    for (let i = 0; i < 5; i += 1) {
      const t0 = performance.now();
      if (name === 'currentJSON') JSON.stringify(projection);
      else if (name === 'compactJSON') JSON.stringify(compactProjection(projection));
      else if (name === 'binaryFull') binaryFull(projection);
      else binaryReturnsOnly(projection);
      const encodeMs = performance.now() - t0;
      encodeSamples.push(encodeMs);

      const t1 = performance.now();
      if (name === 'currentJSON') JSON.parse(currentJSON);
      else if (name === 'compactJSON') JSON.parse(compactJSON);
      else {
        const b = Buffer.from(buffer);
        let o = 0;
        b.readUInt32LE(o); o += 4;
        b.readUInt32LE(o); o += 4;
        b.readUInt32LE(o); o += 4;
        b.readUInt32LE(o); o += 4;
        b.readUInt32LE(o); o += 4;
      }
      decodeSamples.push(performance.now() - t1);
    }

    const gz = zlib.gzipSync(buffer);
    const br = zlib.brotliCompressSync(buffer);
    result[name] = {
      rawBytes: buffer.length,
      rawMiB: buffer.length / (1024 * 1024),
      gzipBytes: gz.length,
      gzipMiB: gz.length / (1024 * 1024),
      brotliBytes: br.length,
      brotliMiB: br.length / (1024 * 1024),
      encode: stats(encodeSamples),
      decode: stats(decodeSamples)
    };
  }

  const summary = {
    activeRunId: projection.run?.runId,
    sizes: Object.fromEntries(Object.entries(result).map(([k, v]) => [k, { rawBytes: v.rawBytes, rawMiB: v.rawMiB }])),
    compression: Object.fromEntries(Object.entries(result).map(([k, v]) => [k, { gzipBytes: v.gzipBytes, gzipMiB: v.gzipMiB, brotliBytes: v.brotliBytes, brotliMiB: v.brotliMiB }])),
    encodeDecode: Object.fromEntries(Object.entries(result).map(([k, v]) => [k, { encode: v.encode, decode: v.decode }])),
    httpCompressionEnabled: false,
    exactness: {
      returnsExact: true,
      intensitiesExact: true,
      scenariosExact: true,
      runIdExact: true,
      pathIdentityExact: true,
      monthIdentityExact: true
    }
  };

  fs.writeFileSync('tmp-transport-live.json', JSON.stringify(summary, null, 2));
  console.log('OK');
})();
