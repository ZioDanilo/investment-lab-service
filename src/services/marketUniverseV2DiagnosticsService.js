const MarketUniverseRunV2 = require('../models/MarketUniverseRunV2');
const MarketUniverseEtfV2 = require('../models/MarketUniverseEtfV2');

const SCENARIOS = ['expansion', 'soft_landing', 'recession', 'stagflation'];
const QUALITY_ISIN = 'IE00BB3QZ601';
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
  const rows = await MarketUniverseEtfV2.findAll({ where: { runId: run.runId, isin: [normalized, QUALITY_ISIN] }, attributes: ['isin', 'returnsBinary', 'valueCount'] });
  const byIsin = new Map(rows.map(row => [row.isin, row]));
  const target = byIsin.get(normalized);
  if (!target) { const error = new Error('ETF not present in active Market Universe'); error.statusCode = 404; throw error; }
  const total = Number(run.pathCount) * Number(run.monthCount);
  if (!run.scenarioBinary || run.scenarioBinary.length !== total) { const error = new Error('Invalid scenario vector geometry'); error.statusCode = 409; throw error; }
  const returns = decodeFloat32(target.returnsBinary, total);
  const intensity = decodeFloat32(run.intensityBinary, total);
  const qualityRow = byIsin.get(QUALITY_ISIN);
  const quality = qualityRow ? decodeFloat32(qualityRow.returnsBinary, total) : null;
  const accum = SCENARIOS.map(() => ({ n: 0, sum: 0, sum2: 0, negative: 0, minIntensity: 1, maxIntensity: 0, sumIntensity: 0, values: [], qSum: 0, qSum2: 0, cross: 0 }));
  for (let i = 0; i < total; i++) {
    const code = run.scenarioBinary[i];
    const x = returns[i], t = intensity[i], y = quality ? quality[i] : 0;
    if (code > 3 || !Number.isFinite(x) || !Number.isFinite(t) || t < 0 || t > 1 || (quality && !Number.isFinite(y))) {
      const error = new Error('Non-finite or invalid Market Universe value at index ' + i); error.statusCode = 409; throw error;
    }
    const a = accum[code];
    a.n++; a.sum += x; a.sum2 += x * x; a.negative += x < 0 ? 1 : 0;
    a.sumIntensity += t; a.minIntensity = Math.min(a.minIntensity, t); a.maxIntensity = Math.max(a.maxIntensity, t);
    a.values.push(x);
    if (quality) { a.qSum += y; a.qSum2 += y * y; a.cross += x * y; }
  }
  const scenarios = accum.map((a, code) => {
    a.values.sort((x, y) => x - y);
    const variance = a.n > 1 ? Math.max(0, (a.sum2 - a.sum * a.sum / a.n) / (a.n - 1)) : 0;
    const cov = quality && a.n > 1 ? (a.cross - a.sum * a.qSum / a.n) / (a.n - 1) : 0;
    const qVar = quality && a.n > 1 ? Math.max(0, (a.qSum2 - a.qSum * a.qSum / a.n) / (a.n - 1)) : 0;
    return {
      scenario: SCENARIOS[code], observations: a.n,
      intensityMean: a.n ? a.sumIntensity / a.n : null,
      intensityMin: a.n ? a.minIntensity : null, intensityMax: a.n ? a.maxIntensity : null,
      monthlyMean: a.n ? a.sum / a.n : null,
      annualizedArithmeticMean: a.n ? a.sum / a.n * 12 : null,
      annualizedVolatility: a.n > 1 ? Math.sqrt(variance * 12) : null,
      negativeMonthsPct: a.n ? a.negative / a.n * 100 : null,
      monthlyP5: percentile(a.values, 0.05),
      qualityCorrelation: quality && variance > 0 && qVar > 0 ? cov / Math.sqrt(variance * qVar) : null
    };
  });
  return {
    runId: run.runId, seed: run.seed, pathCount: run.pathCount, monthCount: run.monthCount,
    isin: normalized, qualityIsin: quality ? QUALITY_ISIN : null,
    scenarios,
    diagnostics: { totalObservations: scenarios.reduce((sum, item) => sum + item.observations, 0), expectedObservations: total, source: 'active_market_universe_v2' },
    warnings: [
      'Theoretical factor expectations are not included: generation-time factor snapshot is not persisted in the active MU. Current DB parameters may differ.',
      ...(!quality ? ['Quality ETF unavailable in active MU; correlations omitted.'] : [])
    ]
  };
}
module.exports = { diagnoseEtf };
