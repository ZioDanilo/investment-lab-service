const MarketUniverseRunV2 = require('../models/MarketUniverseRunV2');
const MarketUniverseEtfV2 = require('../models/MarketUniverseEtfV2');

const SCENARIOS = ['expansion', 'soft_landing', 'recession', 'stagflation'];
const COMPARATORS = {
  world: 'IE00B4L5Y983',
  quality: 'IE00BP3QZ601',
  momentum: 'IE00BL25JP72'
};
function decodeFloat32(buffer, expected) {
  if (!buffer || buffer.length !== expected * 4) {
    const error = new Error('Invalid Market Universe Float32 vector geometry');
    error.statusCode = 409; throw error;
  }
  // Data generated on Node little-endian platforms. DataView avoids unaligned Buffer offsets.
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const result = new Float32Array(expected);
  for (let i = 0; i < expected; i++) result[i] = view.getFloat32(i * 4, true);
  return result;
}
function percentile(sorted, p) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
async function diagnoseEtf(isin) {
  const run = await MarketUniverseRunV2.findOne({ where: { active: true, status: 'ACTIVE' }, order: [['generatedAt', 'DESC']] });
  if (!run) { const error = new Error('No active Market Universe V2'); error.statusCode = 404; throw error; }
  const normalized = String(isin || '').trim().toUpperCase();
  if (!/^[A-Z]{2}[A-Z0-9]{10}$/.test(normalized)) { const error = new Error('Invalid ISIN'); error.statusCode = 400; throw error; }
  const rows = await MarketUniverseEtfV2.findAll({
    where: { runId: run.runId, isin: [...new Set([normalized, ...Object.values(COMPARATORS)])] },
    attributes: ['isin', 'returnsBinary', 'valueCount']
  });
  const byIsin = new Map(rows.map(row => [row.isin, row]));
  const target = byIsin.get(normalized);
  if (!target) { const error = new Error('ETF not present in active Market Universe'); error.statusCode = 404; throw error; }
  const total = Number(run.pathCount) * Number(run.monthCount);
  if (!run.scenarioBinary || run.scenarioBinary.length !== total) { const error = new Error('Invalid scenario vector geometry'); error.statusCode = 409; throw error; }
  const returns = decodeFloat32(target.returnsBinary, total);
  const intensity = decodeFloat32(run.intensityBinary, total);
  const comparators = Object.fromEntries(Object.entries(COMPARATORS).map(([key, comparatorIsin]) => {
    const row = byIsin.get(comparatorIsin);
    return [key, row ? decodeFloat32(row.returnsBinary, total) : null];
  }));
  const accum = SCENARIOS.map(() => ({
    n: 0, sum: 0, sum2: 0, negative: 0, minIntensity: 1, maxIntensity: 0,
    sumIntensity: 0, values: [], indices: []
  }));
  for (let i = 0; i < total; i++) {
    const code = run.scenarioBinary[i];
    const x = returns[i], t = intensity[i];
    if (code > 3 || !Number.isFinite(x) || !Number.isFinite(t) || t < 0 || t > 1 ||
        Object.values(comparators).some(vector => vector && !Number.isFinite(vector[i]))) {
      const error = new Error('Non-finite or invalid Market Universe value at index ' + i); error.statusCode = 409; throw error;
    }
    const a = accum[code];
    a.n++; a.sum += x; a.sum2 += x * x; a.negative += x < 0 ? 1 : 0;
    a.sumIntensity += t; a.minIntensity = Math.min(a.minIntensity, t); a.maxIntensity = Math.max(a.maxIntensity, t);
    a.values.push(x); a.indices.push(i);
  }
  function correlation(indices, other) {
    if (!other || indices.length < 3) return null;
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (const i of indices) {
      const x = returns[i], y = other[i];
      sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
    }
    const n = indices.length;
    const vx = sxx - sx * sx / n, vy = syy - sy * sy / n;
    if (vx <= 0 || vy <= 0) return null;
    return (sxy - sx * sy / n) / Math.sqrt(vx * vy);
  }
  const scenarios = accum.map((a, code) => {
    a.values.sort((x, y) => x - y);
    const variance = a.n > 1 ? Math.max(0, (a.sum2 - a.sum * a.sum / a.n) / (a.n - 1)) : 0;
    const correlations = Object.fromEntries(Object.entries(comparators).map(([key, vector]) => {
      if (!vector || !a.n) return [key, { overall: null, equityWorst5: null, equityWorst10: null, observationsWorst5: 0, observationsWorst10: 0 }];
      // The tail is defined by the comparator equity ETF, not by Managed Futures.
      // Deterministic rank selection handles ties and keeps exactly floor(n * fraction) observations.
      const sorted = [...a.indices].sort((i, j) => vector[i] - vector[j] || i - j);
      const n5 = Math.max(1, Math.floor(sorted.length * 0.05));
      const n10 = Math.max(1, Math.floor(sorted.length * 0.10));
      return [key, {
        overall: correlation(a.indices, vector),
        equityWorst5: correlation(sorted.slice(0, n5), vector),
        equityWorst10: correlation(sorted.slice(0, n10), vector),
        observationsWorst5: n5, observationsWorst10: n10
      }];
    }));
    return {
      scenario: SCENARIOS[code], observations: a.n,
      intensityMean: a.n ? a.sumIntensity / a.n : null,
      intensityMin: a.n ? a.minIntensity : null, intensityMax: a.n ? a.maxIntensity : null,
      monthlyMean: a.n ? a.sum / a.n : null,
      annualizedArithmeticMean: a.n ? a.sum / a.n * 12 : null,
      annualizedVolatility: a.n > 1 ? Math.sqrt(variance * 12) : null,
      negativeMonthsPct: a.n ? a.negative / a.n * 100 : null,
      monthlyP5: percentile(a.values, 0.05),
      qualityCorrelation: correlations.quality.overall,
      correlations
    };
  });

  return {
    runId: run.runId, seed: run.seed, pathCount: run.pathCount, monthCount: run.monthCount,
    isin: normalized,
    qualityIsin: comparators.quality ? COMPARATORS.quality : null,
    comparatorIsins: COMPARATORS,
    scenarios,
    diagnostics: {
      totalObservations: scenarios.reduce((sum, item) => sum + item.observations, 0),
      expectedObservations: total,
      source: 'active_market_universe_v2'
    },
    warnings: [
      'Theoretical factor expectations are not included: generation-time factor snapshot is not persisted in the active MU. Current DB parameters may differ.',
      ...Object.entries(comparators).filter(([, vector]) => !vector).map(([key]) => key + ' ETF unavailable in active MU; its correlations are omitted.')
    ]
  };
}
module.exports = { diagnoseEtf };
