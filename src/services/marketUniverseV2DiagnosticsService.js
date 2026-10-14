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
  function tailMetrics(indices, equity) {
    if (!equity || !indices.length) return null;
    let mfSum = 0, eqSum = 0, mfNegative = 0, bothNegative = 0;
    for (const i of indices) {
      const mf = returns[i], eq = equity[i];
      mfSum += mf; eqSum += eq;
      if (mf < 0) mfNegative++;
      if (mf < 0 && eq < 0) bothNegative++;
    }
    const mfMean = mfSum / indices.length;
    const equityMean = eqSum / indices.length;
    return {
      observations: indices.length,
      equityMean, mfMean,
      mfNegativePct: 100 * mfNegative / indices.length,
      bothNegativePct: 100 * bothNegative / indices.length,
      portfolio80_20Mean: 0.8 * equityMean + 0.2 * mfMean,
      benefit80_20: 0.2 * (mfMean - equityMean)
    };
  }
  function persistenceMetrics(equity) {
    if (!equity) return null;
    const buckets = SCENARIOS.map(() => ({ onset: [], continuing: [], next1: [], next2: [], next3: [] }));
    const months = Number(run.monthCount);
    for (let i = 0; i < total; i++) {
      if (equity[i] > -0.05) continue;
      const month = i % months;
      const bucket = buckets[run.scenarioBinary[i]];
      const continuing = month > 0 && equity[i - 1] <= -0.05;
      (continuing ? bucket.continuing : bucket.onset).push(i);
      if (month + 1 < months) bucket.next1.push(i + 1);
      if (month + 2 < months) bucket.next2.push(i + 2);
      if (month + 3 < months) bucket.next3.push(i + 3);
    }
    return buckets.map(bucket => Object.fromEntries(
      Object.entries(bucket).map(([key, indices]) => [key, tailMetrics(indices, equity)])
    ));
  }
  const persistence = Object.fromEntries(
    Object.entries(comparators).map(([key, equity]) => [key, persistenceMetrics(equity)])
  );
  function rollingMetrics(equity) {
    if (!equity) return null;
    const lengths = [3, 6, 12], months = Number(run.monthCount);
    const data = Object.fromEntries(lengths.map(h => [h, SCENARIOS.map(() => ({
      negative: { n: 0, eq: 0, mf: 0, benefit: 0, mfNeg: 0 },
      persistent: { n: 0, eq: 0, mf: 0, benefit: 0, mfNeg: 0 }
    }))]));
    for (let start = 0; start < total; start += months) {
      for (let t = 0; t < months; t++) {
        let eq = 1, mf = 1, mix = 1, downMonths = 0, peak = 1, wealth = 1, drawdown = 0;
        for (let k = 1; k <= 12 && t + k <= months; k++) {
          const i = start + t + k - 1, er = equity[i], mr = returns[i];
          eq *= 1 + er; mf *= 1 + mr; mix *= 1 + 0.8 * er + 0.2 * mr;
          wealth *= 1 + er; peak = Math.max(peak, wealth);
          drawdown = Math.min(drawdown, wealth / peak - 1);
          if (er < 0) downMonths++;
          if (!lengths.includes(k) || eq >= 1) continue;
          const group = data[k][run.scenarioBinary[start + t]];
          const record = bucket => {
            bucket.n++; bucket.eq += eq - 1; bucket.mf += mf - 1;
            bucket.benefit += mix - eq; if (mf < 1) bucket.mfNeg++;
          };
          record(group.negative);
          if (downMonths >= Math.ceil(k / 2) && drawdown <= -0.05) record(group.persistent);
        }
      }
    }
    const summarize = bucket => bucket.n ? {
      observations: bucket.n, equityMean: bucket.eq / bucket.n,
      mfMean: bucket.mf / bucket.n, benefit80_20: bucket.benefit / bucket.n,
      mfNegativePct: 100 * bucket.mfNeg / bucket.n
    } : null;
    return Object.fromEntries(lengths.map(h => [h, data[h].map(group => ({
      negative: summarize(group.negative), persistent: summarize(group.persistent)
    }))]));
  }
  const rolling = Object.fromEntries(Object.entries(comparators).map(([key, equity]) =>
    [key, rollingMetrics(equity)]));
  const scenarios = accum.map((a, code) => {
    a.values.sort((x, y) => x - y);
    const variance = a.n > 1 ? Math.max(0, (a.sum2 - a.sum * a.sum / a.n) / (a.n - 1)) : 0;
    const downside = {};
    const correlations = Object.fromEntries(Object.entries(comparators).map(([key, vector]) => {
      if (!vector || !a.n) {
        downside[key] = { worst5: null, worst10: null, equityBelowMinus5: null };
        return [key, { overall: null, equityWorst5: null, equityWorst10: null, observationsWorst5: 0, observationsWorst10: 0 }];
      }
      // The tail is defined by the comparator equity ETF, not by Managed Futures.
      // Deterministic rank selection handles ties and keeps exactly floor(n * fraction) observations.
      const sorted = [...a.indices].sort((i, j) => vector[i] - vector[j] || i - j);
      const n5 = Math.max(1, Math.floor(sorted.length * 0.05));
      const n10 = Math.max(1, Math.floor(sorted.length * 0.10));
      downside[key] = {
        worst5: tailMetrics(sorted.slice(0, n5), vector),
        worst10: tailMetrics(sorted.slice(0, n10), vector),
        equityBelowMinus5: tailMetrics(a.indices.filter(i => vector[i] <= -0.05), vector)
      };
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
      correlations, downside,
      rolling: Object.fromEntries(Object.entries(rolling).map(([key, value]) => [key, value ? Object.fromEntries(Object.entries(value).map(([h, groups]) => [h, groups[code]])) : null])),
      persistence: Object.fromEntries(Object.entries(persistence).map(([key, value]) => [key, value ? value[code] : null]))
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
      'Follow-up months are grouped by shock-month scenario, can overlap, and are not proof of dynamic trend adaptation.',
      'Theoretical factor expectations are not included: generation-time factor snapshot is not persisted in the active MU. Current DB parameters may differ.',
      ...Object.entries(comparators).filter(([, vector]) => !vector).map(([key]) => key + ' ETF unavailable in active MU; its correlations are omitted.')
    ]
  };
}
module.exports = { diagnoseEtf };
