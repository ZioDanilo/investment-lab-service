'use strict';
// V6 phase 1: observational audit of generation-time factor return semantics.
// No parameter changes, writes, or claims of incremental premium certification.
const STYLES = new Set(['VALUE','MOMENTUM','QUALITY','LOW_VOLATILITY','GROWTH']);
const SCENARIOS = ['general','expansion','soft_landing','recession','stagflation'];
const normalize = v => String(v ?? '').trim().toUpperCase();
const numberOrNull = v => v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);

function auditStylePremiums({manifestRecord, manifestVerification}) {
  const authenticated = manifestVerification?.status === 'PASS';
  const snapshot = authenticated ? manifestRecord?.manifest?.factorSnapshot : null;
  const factors = Array.isArray(snapshot?.factors) ? snapshot.factors : [];
  const etfs = Array.isArray(snapshot?.etfs) ? snapshot.etfs : [];
  const styleFactors = factors.filter(f => STYLES.has(normalize(f.code)));
  const factorById = new Map(factors.map(f => [String(f.id),f]));
  const rows = styleFactors.map(f => ({
    factorId:f.id, code:normalize(f.code), returnMode:f.returnMode ?? null,
    scenarioExpectedReturns:Object.fromEntries(SCENARIOS.map(s => [s,numberOrNull(f.statistics?.[s]?.expectedReturn)])),
    classification:'UNVERIFIED',
    reason:'The generation manifest contains return targets, but no independently sourced evidence that they represent an incremental premium over the market.'
  }));
  const exposures = etfs.map(e => {
    const links=(e.exposures||[]).map(x=>({factor:factorById.get(String(x.factorId)),beta:numberOrNull(x.beta)}));
    const equityMarket=links.filter(x=>/^(EQUITY|MARKET|MSCI_WORLD|WORLD|GLOBAL_EQUITY|EQUITY_MARKET)$/i.test(normalize(x.factor?.code)));
    const style=links.filter(x=>STYLES.has(normalize(x.factor?.code)));
    return {isin:normalize(e.isin),styleFactors:style.map(x=>({code:normalize(x.factor.code),beta:x.beta})),
      marketFactors:equityMarket.map(x=>({code:normalize(x.factor.code),beta:x.beta})),
      potentialOverlap:style.length>0&&equityMarket.length>0,
      doubleCountingConfirmed:false,
      note:'Co-exposure identifies candidates for review; it does not prove double counting.'};
  }).filter(x=>x.styleFactors.length);
  // Reconstruct deterministic monthly location using the same conventions as
  // investment-lab-core/src/factors/factor-market-universe.js.
  // This is an accounting decomposition, NOT proof of premium provenance.
  const monthlyLocation = (factor, scenario) => {
    const annual = numberOrNull(factor?.statistics?.[scenario]?.expectedReturn);
    if (annual === null) return null;
    const mode = factor.returnMode || 'compounded_return';
    if (mode === 'additive_shock') return annual / 12;
    return mode === 'compounded_return' && annual > -1 ? Math.pow(1 + annual, 1 / 12) - 1 : null;
  };
  const isMarket = code => /^(EQUITY|MARKET|MSCI_WORLD|WORLD|GLOBAL_EQUITY|EQUITY_MARKET)$/i.test(code);
  const decomposition = etfs.filter(e => (e.exposures || []).some(x => STYLES.has(normalize(factorById.get(String(x.factorId))?.code)))).map(e => {
    const annualAlpha = numberOrNull(e.specificRisk?.alpha) ?? 0;
    const scenarios = Object.fromEntries(SCENARIOS.map(scenario => {
      const parts = {market:0,style:0,other:0};
      const details = [];
      let incomplete = false;
      for (const exposure of e.exposures || []) {
        const factor = factorById.get(String(exposure.factorId));
        const beta = numberOrNull(exposure.beta);
        const location = monthlyLocation(factor, scenario);
        if (!factor || beta === null || location === null) { incomplete = true; continue; }
        const code = normalize(factor.code);
        const group = STYLES.has(code) ? 'style' : isMarket(code) ? 'market' : 'other';
        const monthlyContribution = beta * location;
        parts[group] += monthlyContribution;
        details.push({factorCode:code,beta,monthlyFactorLocation:location,monthlyContribution,group});
      }
      const alpha = annualAlpha / 12;
      const total = incomplete ? null : parts.market + parts.style + parts.other + alpha;
      return [scenario,{annualizedArithmeticContributions:{
        market:parts.market*12,style:parts.style*12,other:parts.other*12,
        specificAlpha:annualAlpha,total:total === null ? null : total*12
      },monthlyExpectedLocation:total,complete:!incomplete,factors:details}];
    }));
    return {isin:normalize(e.isin),scenarios,warning:'Annualized arithmetic contributions are monthly locations times 12, not CAGR; scenario intensity and stochastic shocks are excluded.'};
  });
  // V6 reconciliation: deterministic accounting and a zero-style counterfactual.
  // A zero-style scenario is a sensitivity check, not a recommended calibration.
  const reconciliation = decomposition.map(e => {
    const scenarios = Object.fromEntries(SCENARIOS.map(scenario => {
      const row = e.scenarios[scenario];
      const p = row.annualizedArithmeticContributions;
      const withoutStyle = row.complete ? p.market + p.other + p.specificAlpha : null;
      const reconstructed = row.complete ? withoutStyle + p.style : null;
      const discrepancy = reconstructed === null ? null : reconstructed - p.total;
      const marketAndStyle = row.factors.some(f => f.group === 'market') &&
        row.factors.some(f => f.group === 'style');
      return [scenario,{
        complete:row.complete,
        configuredAnnualizedArithmetic:p.total,
        withoutStyleAnnualizedArithmetic:withoutStyle,
        incrementalStyleAnnualizedArithmetic:p.style,
        reconstructionDifference:discrepancy,
        accountingCheck:row.complete && Math.abs(discrepancy) < 1e-10 ? 'PASS' : 'UNVERIFIED',
        marketStyleCoExposure:marketAndStyle,
        premiumSemantics:'NOT_ESTABLISHED'
      }];
    }));
    return {isin:e.isin,scenarios};
  });
  const reconciliationSummary = {
    etfCount:reconciliation.length,
    scenarioCount:SCENARIOS.length,
    completeScenarioRows:reconciliation.reduce((n,e)=>n+SCENARIOS.filter(s=>e.scenarios[s].complete).length,0),
    arithmeticIdentity:'total = market + style + other + specificAlpha',
    counterfactual:'style factor contribution set to zero; market, other factors and specific alpha unchanged',
    limitation:'This is a deterministic location sensitivity, not a Monte Carlo replay or evidence that the style factor premium is independent of market returns.'
  };
  return {version:6,phase:'STYLE_PREMIUM_PROVENANCE',readOnly:true,
    status:authenticated?'EVIDENCE_REQUIRED':'BLOCKED_UNVERIFIED_MANIFEST',
    manifestSha256:authenticated?manifestRecord.manifestSha256:null,
    factors:rows,etfExposures:exposures,returnDecomposition:decomposition,reconciliation,reconciliationSummary,engineFormula:'monthly ETF return = sum(beta * monthly factor return) + annual specific alpha / 12 + residual shock * monthly residual volatility',
    checks:[{id:'GENERATION_INPUT_AUTHENTICATED',status:authenticated?'PASS':'UNVERIFIED'},
      {id:'STYLE_PREMIUM_INCREMENTAL_EVIDENCE',status:'UNVERIFIED'},
      {id:'STYLE_PREMIUM_DOUBLE_COUNTING_EXCLUDED',status:'UNVERIFIED'}],
    requiredEvidence:['For each style factor, cite the return series, benchmark, calculation formula, currency and period.',
      'Establish whether the expected return is a total return or excess return over the equity market.',
      'Check market-plus-style ETF exposures and specific-risk alpha for overlapping return contributions.'],
    limitation:'No automatic changes to factor expected returns or ETF exposures; factor codes alone cannot certify premium semantics.'};
}
module.exports={auditStylePremiums};
