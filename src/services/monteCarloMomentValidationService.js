'use strict';
// Exact intensity-weighted analytical moments of the current factor generator.
// O(months * (factors + ETFs^2)) rather than O(months * ETF^2 * exposures^2).
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const SCENARIOS = ['expansion','soft_landing','recession','stagflation'];
const pair = (a,b) => [String(a),String(b)].sort().join(':');
const location = (annual, mode) => mode === 'additive_shock' ? annual/12 : Math.pow(1+annual,1/12)-1;

function calculateMomentValidation({ snapshot, etfs, correlations, scenarioBytes, intensity, run }) {
  const started = performance.now();
  const n = scenarioBytes.length;
  if (!n || n !== intensity.length) throw new Error('Invalid moment validation timeline');
  const observed = new Map(etfs.map(e => [String(e.isin).toUpperCase(),e]));
  const ordered = snapshot.etfs.filter(e => observed.has(String(e.isin).toUpperCase()));
  const E = ordered.length, F = snapshot.factors.length;
  const factorIndex = new Map(snapshot.factors.map((f,i)=>[String(f.id),i]));
  const exposures = ordered.map(e => {
    const row = new Float64Array(F);
    for(const x of e.exposures||[]) {
      const j = factorIndex.get(String(x.factorId));
      if(j == null) throw new Error('Unknown factor in moment validation');
      row[j] += Number(x.beta);
    }
    return row;
  });
  const alpha = ordered.map(e=>Number(e.specificRisk?.alpha||0)/12);
  const residual = ordered.map(e=>Number(e.specificRisk?.residualVolatility??e.specificRisk?.annualizedVolatility??0));
  const expectedMean = new Float64Array(E);
  const expectedSecond = new Float64Array(E*E);
  // Factor covariance is quadratic in intensity because annual factor volatility
  // is interpolated linearly: (v0 + dv*t)(w0 + dw*t)*rho / 12.
  // Integrate the polynomial exactly using sum(t) and sum(t*t) per scenario.
  const moments = SCENARIOS.map(()=>({count:0,sumT:0,sumT2:0}));
  const covariancePolynomials = SCENARIOS.map(scenario=>{
    const rho = Array.from({length:F},(_,i)=>Array.from({length:F},(_,j)=>{
      if(i===j)return 1;
      const v=snapshot.correlations?.[scenario]?.[pair(snapshot.factors[i].id,snapshot.factors[j].id)];
      if(v == null || !Number.isFinite(Number(v)))throw new Error('Missing factor correlation');
      return Number(v);
    }));
    const coefficients = Array.from({length:3},()=>new Float64Array(E*E));
    for(let a=0;a<E;a++)for(let b=a;b<E;b++){
      let c0=0,c1=0,c2=0;
      for(let i=0;i<F;i++){
        const ai=exposures[a][i]; if(ai===0)continue;
        const f=snapshot.factors[i];
        const v0=Number(f.statistics.general.volatility);
        const dv=Number(f.statistics[scenario].volatility)-v0;
        for(let j=0;j<F;j++){
          const bj=exposures[b][j]; if(bj===0)continue;
          const g=snapshot.factors[j],w0=Number(g.statistics.general.volatility);
          const dw=Number(g.statistics[scenario].volatility)-w0;
          const scale=ai*bj*rho[i][j]/12;
          c0+=scale*v0*w0;
          c1+=scale*(v0*dw+dv*w0);
          c2+=scale*dv*dw;
        }
      }
      if(a===b)c0+=residual[a]*residual[a]/12;
      const ix=a*E+b,iy=b*E+a;
      coefficients[0][ix]=coefficients[0][iy]=c0;
      coefficients[1][ix]=coefficients[1][iy]=c1;
      coefficients[2][ix]=coefficients[2][iy]=c2;
    }
    return coefficients;
  });
  const factorMeans = new Float64Array(F), etfMeans = new Float64Array(E);
  let invalid=0;
  for(let k=0;k<n;k++){
    const sc=scenarioBytes[k],t=Number(intensity[k]);
    if(sc>=4 || !Number.isFinite(t) || t<0 || t>1){invalid++;continue;}
    const m=moments[sc];m.count++;m.sumT+=t;m.sumT2+=t*t;
    for(let j=0;j<F;j++){
      const f=snapshot.factors[j],g=f.statistics.general,s=f.statistics[SCENARIOS[sc]];
      const annual=Number(g.expectedReturn)+(Number(s.expectedReturn)-Number(g.expectedReturn))*t;
      if(f.returnMode!=='additive_shock' && annual<=-1)throw new Error('Invalid compound return');
      factorMeans[j]=location(annual,f.returnMode);
    }
    for(let a=0;a<E;a++){
      let mu=alpha[a],row=exposures[a];
      for(let j=0;j<F;j++)if(row[j])mu+=row[j]*factorMeans[j];
      etfMeans[a]=mu;expectedMean[a]+=mu;
    }
    // Accumulate mean cross-products; the covariance shock term is integrated
    // separately via the scenario polynomial, avoiding factor-pair loops/month.
    for(let a=0;a<E;a++)for(let b=a;b<E;b++)
      expectedSecond[a*E+b]+=etfMeans[a]*etfMeans[b];
  }
  if(invalid)return {version:4,status:'UNVERIFIED',reason:'Invalid scenario or intensity observations',invalid};
  for(let sc=0;sc<4;sc++){
    const m=moments[sc],coefficients=covariancePolynomials[sc];
    for(let a=0;a<E;a++)for(let b=a;b<E;b++){
      const ix=a*E+b;
      expectedSecond[ix]+=coefficients[0][ix]*m.count+
        coefficients[1][ix]*m.sumT+coefficients[2][ix]*m.sumT2;
    }
  }
  const variance=new Float64Array(E);
  for(let a=0;a<E;a++){
    expectedMean[a]/=n;
    variance[a]=Math.max(0,expectedSecond[a*E+a]/n-expectedMean[a]**2);
  }
  const results=ordered.map((e,a)=>{
    const real=observed.get(String(e.isin).toUpperCase()),mu=expectedMean[a],v=variance[a];
    return {isin:e.isin,expectedAnnualArithmeticReturn:mu*12,
      observedAnnualArithmeticReturn:Number(real.meanMonthlyReturn)*12,
      expectedAnnualVolatility:Math.sqrt(v*12),
      observedAnnualVolatility:Number(real.realizedAnnualVolatility),
      monthlyMeanStandardErrorIidReference:Math.sqrt(v/n),
      annualMeanDeviation:(Number(real.meanMonthlyReturn)-mu)*12,
      annualVolatilityDeviation:Number(real.realizedAnnualVolatility)-Math.sqrt(v*12),
      verdict:'UNVERIFIED',
      reason:'Generation-time factor snapshot identity and dependence-adjusted uncertainty are not established.'};
  });
  const observedCorr=new Map(correlations.map(c=>[pair(c.isinA,c.isinB),c.correlation]));
  const corrResults=[];
  for(let a=0;a<E;a++)for(let b=a+1;b<E;b++){
    const key=pair(ordered[a].isin,ordered[b].isin);
    const cov=expectedSecond[a*E+b]/n-expectedMean[a]*expectedMean[b];
    const denom=Math.sqrt(variance[a]*variance[b]);
    const expected=denom>0?Math.max(-1,Math.min(1,cov/denom)):null;
    const actual=observedCorr.get(key)??null;
    corrResults.push({isinA:ordered[a].isin,isinB:ordered[b].isin,
      expected,observed:actual,deviation:expected!=null&&actual!=null?actual-expected:null,
      verdict:'UNVERIFIED'});
  }
  const fingerprint=crypto.createHash('sha256').update(JSON.stringify({
    factorOrder:snapshot.factorOrder,
    factors:snapshot.factors.map(f=>({id:f.id,code:f.code,returnMode:f.returnMode,statistics:f.statistics})),
    correlations:snapshot.correlations,
    etfs:ordered.map(e=>({isin:e.isin,exposures:e.exposures,specificRisk:e.specificRisk}))
  })).digest('hex');
  return {version:4,status:'UNVERIFIED',readOnly:true,runId:run.runId,
    currentConfigurationSha256:fingerprint,configurationProvenance:'CURRENT_DATABASE_NOT_GENERATION_TIME',
    comparisonBasis:'exact intensity-weighted unconditional monthly moments of current generator; ETF residual shocks independent',
    etfs:results,correlations:corrResults,
    performance:{elapsedMs:Math.round(performance.now()-started),algorithm:'factor_covariance_polynomial_scenario_aggregation'},
    limitations:['The run did not persist its immutable generation-time factor snapshot or digest.',
      'The iid standard error is descriptive only: month-to-month dependence requires robust inference.',
      'No historical out-of-sample validation is implied.']};
}
module.exports={calculateMomentValidation};
