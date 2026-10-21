'use strict';
// Analytical first/second moments for the EXACT monthly factor generator, conditional
// on the persisted macro timeline. Does not regenerate returns or mutate the MU.
const crypto = require('node:crypto');
const scenarios = ['expansion','soft_landing','recession','stagflation'];
const pair = (a,b) => [String(a),String(b)].sort().join(':');
const location = (annual, mode) => mode === 'additive_shock'
  ? annual/12 : Math.pow(1+annual,1/12)-1;
const avg = (sum,n) => sum/n;
function calculateMomentValidation({ snapshot, etfs, correlations, scenarioBytes, intensity, run }) {
  const factors = new Map(snapshot.factors.map(f=>[String(f.id),f]));
  const ordered = snapshot.etfs.filter(e=>etfs.some(x=>x.isin===e.isin));
  const n = scenarioBytes.length;
  if (n !== intensity.length || !n) throw new Error('Invalid moment validation timeline');
  const means = new Map(), second = new Map(), cross = new Map();
  for(const e of ordered){means.set(e.isin,0);second.set(e.isin,0);}
  for(let i=0;i<ordered.length;i++) for(let j=i+1;j<ordered.length;j++)
    cross.set(pair(ordered[i].isin,ordered[j].isin),0);
  let invalid=0;
  for(let k=0;k<n;k++){
    const scenario=scenarios[scenarioBytes[k]], t=Number(intensity[k]);
    if(!scenario || !Number.isFinite(t) || t<0 || t>1){invalid++;continue;}
    const moments=new Map();
    for(const e of ordered){
      const exposures=e.exposures||[];
      let mu=Number(e.specificRisk?.alpha||0)/12;
      for(const x of exposures){
        const f=factors.get(String(x.factorId));
        if(!f) throw new Error('Unknown factor in analytical moment validation');
        const g=f.statistics.general, s=f.statistics[scenario];
        const annual=Number(g.expectedReturn)+(Number(s.expectedReturn)-Number(g.expectedReturn))*t;
        if(f.returnMode!=='additive_shock' && annual<=-1) throw new Error('Invalid compound return for analytical validation');
        mu+=Number(x.beta)*location(annual,f.returnMode);
      }
      moments.set(e.isin,mu);
      means.set(e.isin,means.get(e.isin)+mu);
    }
    const covariance=(a,b)=>{
      let cov=0;
      for(const x of a.exposures||[]) for(const y of b.exposures||[]){
        const fx=factors.get(String(x.factorId)),fy=factors.get(String(y.factorId));
        const vx=Number(fx.statistics.general.volatility)+(Number(fx.statistics[scenario].volatility)-Number(fx.statistics.general.volatility))*t;
        const vy=Number(fy.statistics.general.volatility)+(Number(fy.statistics[scenario].volatility)-Number(fy.statistics.general.volatility))*t;
        const rho=String(x.factorId)===String(y.factorId)?1:
          Number(snapshot.correlations[scenario][pair(x.factorId,y.factorId)]);
        if(!Number.isFinite(rho))throw new Error('Missing correlation for analytical validation');
        cov+=Number(x.beta)*Number(y.beta)*vx*vy*rho/12;
      }
      if(a.isin===b.isin){
        const residual=Number(a.specificRisk?.residualVolatility??a.specificRisk?.annualizedVolatility??0);
        cov+=residual*residual/12;
      }
      return cov;
    };
    for(const e of ordered){
      const mu=moments.get(e.isin);
      second.set(e.isin,second.get(e.isin)+mu*mu+covariance(e,e));
    }
    for(let i=0;i<ordered.length;i++)for(let j=i+1;j<ordered.length;j++){
      const a=ordered[i],b=ordered[j],key=pair(a.isin,b.isin);
      cross.set(key,cross.get(key)+moments.get(a.isin)*moments.get(b.isin)+covariance(a,b));
    }
  }
  if(invalid) return { status:'UNVERIFIED', reason:'Invalid scenario or intensity observations',invalid };
  const variance=new Map();
  const results=ordered.map(e=>{
    const mean=avg(means.get(e.isin),n);
    const v=Math.max(0,avg(second.get(e.isin),n)-mean*mean);
    variance.set(e.isin,v);
    const actual=etfs.find(x=>x.isin===e.isin);
    const observed=Number(actual.meanMonthlyReturn), observedVol=Number(actual.realizedAnnualVolatility);
    const seMean=Math.sqrt(v/n);
    // Naive standard error is NOT a valid confidence bound under serial dependence.
    return { isin:e.isin, expectedAnnualArithmeticReturn:mean*12,
      observedAnnualArithmeticReturn:observed*12, expectedAnnualVolatility:Math.sqrt(v*12),
      observedAnnualVolatility:observedVol, monthlyMeanStandardErrorIidReference:seMean,
      annualMeanDeviation:(observed-mean)*12,
      annualVolatilityDeviation:observedVol-Math.sqrt(v*12),
      verdict:'UNVERIFIED', reason:'Theoretical moments use current factor settings; run-time snapshot identity and dependence-adjusted uncertainty are not established.' };
  });
  const corrResults=[];
  for(let i=0;i<ordered.length;i++)for(let j=i+1;j<ordered.length;j++){
    const a=ordered[i],b=ordered[j],key=pair(a.isin,b.isin);
    const cov=avg(cross.get(key),n)-avg(means.get(a.isin),n)*avg(means.get(b.isin),n);
    const denom=Math.sqrt(variance.get(a.isin)*variance.get(b.isin));
    const expected=denom>0?Math.max(-1,Math.min(1,cov/denom)):null;
    const actual=correlations.find(x=>pair(x.isinA,x.isinB)===key);
    corrResults.push({isinA:a.isin,isinB:b.isin,expected,observed:actual?.correlation??null,
      deviation:expected!=null&&actual?.correlation!=null?actual.correlation-expected:null,
      verdict:'UNVERIFIED'});
  }
  const fingerprint=crypto.createHash('sha256').update(JSON.stringify({
    factorOrder:snapshot.factorOrder,factors:snapshot.factors.map(f=>({
      id:f.id,code:f.code,returnMode:f.returnMode,statistics:f.statistics
    })),correlations:snapshot.correlations,
    etfs:ordered.map(e=>({isin:e.isin,exposures:e.exposures,specificRisk:e.specificRisk}))
  })).digest('hex');
  return {version:4,status:'UNVERIFIED',readOnly:true,runId:run.runId,
    currentConfigurationSha256:fingerprint,configurationProvenance:'CURRENT_DATABASE_NOT_GENERATION_TIME',
    comparisonBasis:'exact intensity-weighted unconditional monthly moments of current generator; ETF residual shocks independent',
    etfs:results,correlations:corrResults,
    limitations:['The run did not persist its immutable generation-time factor snapshot or digest.',
      'The iid standard error is descriptive only: month-to-month dependence and cross-path effects require block/bootstrap inference.',
      'No historical out-of-sample validation is implied.']};
}
module.exports={calculateMomentValidation};
