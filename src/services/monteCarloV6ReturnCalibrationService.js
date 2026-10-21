'use strict';
/**
 * Read-only V6 calibration sensitivity. Uses only authenticated generation-time
 * factor snapshots. No DB mutations, factor updates or Monte Carlo replay.
 */
const SCENARIOS = ['general','expansion','soft_landing','recession','stagflation'];
const FOCUS = ['MOMENTUM','VALUE','SIZE_SMALL_CAP'];
const normalize = value => String(value ?? '').trim().toUpperCase();
const finite = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
const MODELS = {
  prudent: {MOMENTUM:0.015, VALUE:0.0075, SIZE_SMALL_CAP:0},
  central: {MOMENTUM:0.025, VALUE:0.0175, SIZE_SMALL_CAP:0.0075},
  optimistic: {MOMENTUM:0.035, VALUE:0.025, SIZE_SMALL_CAP:0.015}
};
const annualToMonthly = (annual, mode) =>
  mode === 'additive_shock' ? annual / 12 :
  mode === 'compounded_return' && annual > -1 ? Math.pow(1 + annual, 1/12) - 1 : null;

function calibrateReturnsV6({manifestRecord, manifestVerification}) {
  const verified = manifestVerification?.status === 'PASS';
  const snapshot = verified ? manifestRecord?.manifest?.factorSnapshot : null;
  if (!snapshot || !Array.isArray(snapshot.factors) || !Array.isArray(snapshot.etfs)) {
    return {version:6,phase:'RETURN_CALIBRATION',readOnly:true,status:'BLOCKED_UNVERIFIED_MANIFEST',
      manifestSha256:null,etfCount:0,scenarioCount:SCENARIOS.length,factors:[],etfs:[],
      checks:[{id:'GENERATION_MANIFEST',status:'UNVERIFIED'}],
      limitation:'Calibration requires an authenticated generation-time snapshot; live DB parameters must not be substituted.'};
  }
  const byId = new Map(snapshot.factors.map(f=>[String(f.id),f]));
  const byCode = new Map(snapshot.factors.map(f=>[normalize(f.code),f]));
  const focus = FOCUS.map(code => {
    const f=byCode.get(code);
    return {code,present:!!f,returnMode:f?.returnMode??null,
      configured: Object.fromEntries(SCENARIOS.map(s=>[s,finite(f?.statistics?.[s]?.expectedReturn)])),
      candidates:Object.fromEntries(Object.entries(MODELS).map(([name,values])=>[name,values[code]])),
      provenance:'UNVERIFIED_INCREMENTAL_PREMIUM'};
  });
  const etfs = snapshot.etfs.map(etf => {
    const annualAlpha=finite(etf.specificRisk?.alpha) ?? 0;
    const exposure=(etf.exposures||[]).map(link=>({
      factor:byId.get(String(link.factorId)), beta:finite(link.beta)
    }));
    const exposures=exposure.map(({factor,beta})=>({code:normalize(factor?.code),beta}));
    const scenarios=Object.fromEntries(SCENARIOS.map(scenario=>{
      const details=[];
      const groups={market:0,style:0,other:0};
      let baseline=annualAlpha/12;
      let complete=true;
      const scenariosByName={};
      for(const [name,values] of Object.entries(MODELS)) scenariosByName[name]=annualAlpha/12;
      for(const {factor,beta} of exposure){
        const code=normalize(factor?.code);
        const annual=finite(factor?.statistics?.[scenario]?.expectedReturn);
        const mode=factor?.returnMode ?? 'compounded_return';
        const original=annual===null?null:annualToMonthly(annual,mode);
        if(!factor || beta===null || original===null){
          complete=false;
          details.push({code,beta,annualFactorTarget:annual,valid:false});
          continue;
        }
        const baseContribution=beta*original;
        baseline+=baseContribution;
        const group=code==='GLOBAL_EQUITY'?'market':['MOMENTUM','VALUE','QUALITY','LOW_VOLATILITY','GROWTH'].includes(code)?'style':'other';
        groups[group]+=baseContribution;
        details.push({code,beta,annualFactorTarget:annual,monthlyLocation:original,
          annualizedArithmeticContribution:12*baseContribution,group,valid:true});
        for(const [name,values] of Object.entries(MODELS)){
          // Candidates are anchored to the historical GENERAL premium.
          // Keep scenario deviations in annual-factor space rather than overriding
          // every scenario with the same value.
          const general=finite(factor.statistics?.general?.expectedReturn);
          const candidate=Object.hasOwn(values,code) && general!==null
            ? annual+(values[code]-general):annual;
          const monthly=annualToMonthly(candidate,mode);
          if(monthly===null) complete=false;
          else scenariosByName[name]+=beta*monthly;
        }
      }
      const baselineAnnual=complete?baseline*12:null;
      return [scenario,{
        complete,baselineAnnualizedArithmetic:baselineAnnual,
        contributions:complete?Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,12*v]).concat([['specificAlpha',annualAlpha]])):null,
        candidates:Object.fromEntries(Object.entries(MODELS).map(([name])=>[name,{
          annualizedArithmetic:complete?scenariosByName[name]*12:null,
          deltaAnnualizedArithmetic:complete?(scenariosByName[name]-baseline)*12:null
        }])),
        factors:details,
        note:'Monthly deterministic factor location ×12, not CAGR or realized simulated mean.'
      }];
    }));
    const overlap=exposures.some(x=>x.code==='GLOBAL_EQUITY')&&exposures.some(x=>FOCUS.includes(x.code)||['QUALITY','LOW_VOLATILITY','GROWTH'].includes(x.code));
    return {isin:normalize(etf.isin),exposures,specificAlpha:annualAlpha,
      marketStyleCoExposure:overlap,premiumDoubleCountingConfirmed:false,scenarios};
  });
  return {version:6,phase:'RETURN_CALIBRATION',readOnly:true,status:'SENSITIVITY_ONLY',
    manifestSha256:manifestRecord.manifestSha256,etfCount:etfs.length,scenarioCount:SCENARIOS.length,
    candidates:MODELS,factors:focus,etfs,
    checks:[{id:'GENERATION_MANIFEST',status:'PASS'},
      {id:'ALL_SCENARIO_ROWS_COMPLETE',status:etfs.every(e=>Object.values(e.scenarios).every(s=>s.complete))?'PASS':'UNVERIFIED'},
      {id:'INCREMENTAL_PREMIUM_PROVENANCE',status:'UNVERIFIED'},
      {id:'DOUBLE_COUNTING_EXCLUDED',status:'UNVERIFIED'}],
    methodology:'For each regime, calibrated annual factor target = original regime target + (candidate general premium - manifest general premium). The existing returnMode is applied before exposure-weighted monthly aggregation. This preserves annual factor target differences across regimes, not necessarily equal monthly or simulated regime differences.',
    limitation:'Hypothetical annual factor targets, not certified incremental premia. No stored parameters were changed, and no Monte Carlo simulation was executed.'};
}
module.exports={calibrateReturnsV6};
