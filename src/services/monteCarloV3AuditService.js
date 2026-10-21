'use strict';

// V3 is observational only: never mutate factor parameters or the active MU.
const SCENARIOS = ['expansion', 'soft_landing', 'recession', 'stagflation'];
const STYLE = new Set(['VALUE','MOMENTUM','QUALITY','LOW_VOLATILITY','GROWTH']);
const normalize = value => String(value || '').trim().toUpperCase();
const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
const correlationKey = (a,b) => [String(a),String(b)].sort().join(':');
const annualLocation = (value, mode) => mode === 'additive_shock'
  ? Number(value) : Math.pow(1 + Number(value), 1 / 12) * 12 - 12;

async function buildMonteCarloV3Audit({ factorSnapshot, macroSnapshot, etfs, correlations, conditionalCorrelations, scenarios, scenarioBytes, pathCount, monthCount }) {
  const factorById = new Map(factorSnapshot.factors.map(f => [String(f.id), f]));
  const audit = { version: 3, readOnly: true, warnings: [], limitations: [], stylePremia: [],
    bondAndFx: [], theoreticalVsSimulated: [], correlationComparisons: [], regimePersistence: [] };
  // An additive style premium must not be mistaken for a full equity return.
  for (const factor of factorSnapshot.factors) {
    if (!STYLE.has(normalize(factor.code))) continue;
    const mode = factor.returnMode || 'compounded_return';
    const scenarioValues = Object.fromEntries(SCENARIOS.map(s => [s, {
      annualExpectedReturn: finite(factor.statistics?.[s]?.expectedReturn),
      annualVolatility: finite(factor.statistics?.[s]?.volatility)
    }]));
    audit.stylePremia.push({ factorCode: factor.code, returnMode: mode, scenarioValues,
      classification: mode === 'additive_shock' ? 'incremental_shock_mode' : 'ambiguous_total_or_incremental',
      note: 'Return mode alone cannot establish whether the stored expectation is an incremental equity premium.' });
    if (mode !== 'additive_shock') audit.warnings.push({ code: 'STYLE_PREMIUM_SEMANTICS_UNVERIFIED', factorCode: factor.code });
  }
  const byIsin = new Map(etfs.map(e => [normalize(e.isin), e]));
  for (const etf of factorSnapshot.etfs) {
    const actual = byIsin.get(normalize(etf.isin));
    if (!actual) continue;
    const exposures = (etf.exposures || []).map(e => {
      const factor = factorById.get(String(e.factorId));
      return { factorCode: factor?.code || String(e.factorId), beta: finite(e.beta),
        returnMode: factor?.returnMode || 'compounded_return', factor };
    });
    const fx = exposures.filter(e => /(^FX|FX_|USD|EURUSD|CURRENCY|FOREX)/i.test(e.factorCode));
    const bond = exposures.filter(e => /GOV|BOND|DURATION|INFLATION|YIELD|CREDIT|CORPORATE|SPREAD|RATE/i.test(e.factorCode));
    const isDefensive = /CASH|OVERNIGHT|SHORT|GOV|BOND|TREASURY|ULTRA/i.test([etf.name,...exposures.map(e=>e.factorCode)].join(' '));
    const scenariosOutput = [];
    for (const scenario of SCENARIOS) {
      const realized = actual.byScenario?.find(x => x.scenario === scenario);
      const contributions = exposures.map(e => ({
        factorCode: e.factorCode, beta: e.beta,
        annualizedLocationContribution: e.factor && e.beta != null
          ? e.beta * annualLocation(e.factor.statistics?.[scenario]?.expectedReturn ?? 0, e.returnMode) : null
      }));
      const theoreticalLocation = contributions.reduce((sum, c) => sum + (c.annualizedLocationContribution || 0), Number(etf.specificRisk?.alpha || 0));
      scenariosOutput.push({ scenario, expectedAnnualLocationAtFullIntensity: theoreticalLocation,
        realizedAnnualArithmeticReturn: realized?.annualizedMeanReturn ?? null,
        realizedAnnualVolatility: realized?.annualizedVolatility ?? null,
        contributions,
        comparable: false,
        reason: 'Persisted simulation blends scenario statistics with general baseline by intensity; full-intensity expected location is not a direct target.' });
    }
    audit.theoreticalVsSimulated.push({ isin: normalize(etf.isin),
      realizedAnnualVolatility: actual.realizedAnnualVolatility,
      referenceAnnualVolatility: finite(etf.specificRisk?.annualizedVolatility),
      scenarios: scenariosOutput });
    if (isDefensive || fx.length || bond.length) {
      const row = { isin: normalize(etf.isin), name: etf.name, fxFactors: fx.map(e=>e.factorCode),
        bondFactors: bond.map(e=>e.factorCode), simulatedAnnualVolatility: actual.realizedAnnualVolatility,
        referenceAnnualVolatility: finite(etf.specificRisk?.annualizedVolatility),
        currencyHedgeVerified: false, durationVerified: false,
        limitation: 'Snapshot does not expose verified instrument currency, hedge status, effective duration or convexity.' };
      audit.bondAndFx.push(row);
      if (isDefensive && !bond.length && !fx.length) audit.warnings.push({
        code: 'DEFENSIVE_ETF_WITHOUT_IDENTIFIED_BOND_OR_FX_FACTOR', isin: row.isin });
      if (fx.length) audit.warnings.push({ code: 'ETF_FX_HEDGE_STATUS_UNVERIFIED', isin: row.isin });
      if (bond.length) audit.warnings.push({ code: 'ETF_DURATION_NOT_EXPLICITLY_VERIFIED', isin: row.isin });
    }
  }
  const realizedByPair = new Map(correlations.map(c=>[correlationKey(c.isinA,c.isinB),c]));
  const conditionalByPair = new Map();
  for (const c of conditionalCorrelations) conditionalByPair.set(correlationKey(c.isinA,c.isinB)+':'+c.scenario,c);
  // Compute theoretical correlations using the scenario factor covariance and residual variance.
  const supported = factorSnapshot.etfs.filter(e=>byIsin.has(normalize(e.isin)));
  const covariance = (a,b,scenario) => {
    let sum = 0;
    for (const x of a.exposures || []) for (const y of b.exposures || []) {
      const fx = factorById.get(String(x.factorId)), fy = factorById.get(String(y.factorId));
      const vx = finite(fx?.statistics?.[scenario]?.volatility);
      const vy = finite(fy?.statistics?.[scenario]?.volatility);
      if (vx == null || vy == null) return null;
      const corr = String(x.factorId) === String(y.factorId) ? 1 :
        finite(factorSnapshot.correlations?.[scenario]?.[correlationKey(x.factorId,y.factorId)]);
      if (corr == null) return null;
      sum += Number(x.beta)*Number(y.beta)*vx*vy*corr;
    }
    return sum;
  };
  for (let i=0;i<supported.length;i++) for (let j=i+1;j<supported.length;j++) {
    const a=supported[i],b=supported[j], key=correlationKey(a.isin,b.isin);
    for (const scenario of SCENARIOS) {
      const cov=covariance(a,b,scenario), va=covariance(a,a,scenario), vb=covariance(b,b,scenario);
      const ra=finite(a.specificRisk?.residualVolatility ?? a.specificRisk?.annualizedVolatility);
      const rb=finite(b.specificRisk?.residualVolatility ?? b.specificRisk?.annualizedVolatility);
      const denom=va!=null&&vb!=null&&ra!=null&&rb!=null
        ? Math.sqrt(Math.max(0,va+ra*ra)*Math.max(0,vb+rb*rb)) : 0;
      const theory=cov!=null&&denom>0 ? cov/denom : null;
      const observed=conditionalByPair.get(key+':'+scenario);
      audit.correlationComparisons.push({ isinA:normalize(a.isin), isinB:normalize(b.isin),scenario,
        theoreticalFullIntensity: theory, simulatedConditional: observed?.correlation ?? null,
        directlyComparable: false, reason: 'Simulated factor volatility interpolates with intensity; pooled scenario observations have heterogeneous intensities.' });
    }
  }
  // Durations are computed from the persisted timeline, not configured transition assumptions.
  for (let sc=0;sc<SCENARIOS.length;sc++) {
    const lengths=[];
    for (let p=0;p<pathCount;p++) {
      let len=0;
      for(let m=0;m<monthCount;m++){
        if(scenarioBytes[p*monthCount+m]===sc) len++;
        else if(len){lengths.push(len);len=0;}
      }
      if(len) lengths.push(len);
    }
    lengths.sort((a,b)=>a-b);
    const q = fraction => lengths.length ? lengths[Math.floor((lengths.length-1)*fraction)] : null;
    audit.regimePersistence.push({ scenario:SCENARIOS[sc], spellCount:lengths.length,
      medianMonths:q(.5), p90Months:q(.9), p95Months:q(.95), p99Months:q(.99),
      maxMonths:lengths[lengths.length-1] || 0,
      observedMeanMonths:scenarios.find(s=>s.scenario===SCENARIOS[sc])?.meanSpellMonths ?? null });
  }
  audit.limitations.push('V3 uses the current live factor configuration; the active run may have been generated with an older snapshot.');
  audit.limitations.push('Macro transition settings are not assumed to be historical targets; regime duration percentiles are descriptive.');
  audit.limitations.push('No verified currency-hedging or duration metadata is present in the factor snapshot; these are flagged, never inferred.');
  audit.limitations.push('Theoretical correlations assume independent ETF-specific residual shocks, matching the current generator; shared residual risks are not modeled.');
  return audit;
}
module.exports = { buildMonteCarloV3Audit };
