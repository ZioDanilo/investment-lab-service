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
  return {version:6,phase:'STYLE_PREMIUM_PROVENANCE',readOnly:true,
    status:authenticated?'EVIDENCE_REQUIRED':'BLOCKED_UNVERIFIED_MANIFEST',
    manifestSha256:authenticated?manifestRecord.manifestSha256:null,
    factors:rows,etfExposures:exposures,
    checks:[{id:'GENERATION_INPUT_AUTHENTICATED',status:authenticated?'PASS':'UNVERIFIED'},
      {id:'STYLE_PREMIUM_INCREMENTAL_EVIDENCE',status:'UNVERIFIED'},
      {id:'STYLE_PREMIUM_DOUBLE_COUNTING_EXCLUDED',status:'UNVERIFIED'}],
    requiredEvidence:['For each style factor, cite the return series, benchmark, calculation formula, currency and period.',
      'Establish whether the expected return is a total return or excess return over the equity market.',
      'Check market-plus-style ETF exposures and specific-risk alpha for overlapping return contributions.'],
    limitation:'No automatic changes to factor expected returns or ETF exposures; factor codes alone cannot certify premium semantics.'};
}
module.exports={auditStylePremiums};
