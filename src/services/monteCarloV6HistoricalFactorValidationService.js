'use strict';
// Historical V6 factor premium validation. No database access or writes.
// Input: aligned monthly decimal excess factor returns (not total ETF returns).
const FACTORS=['MOMENTUM','VALUE','SIZE_SMALL_CAP'];
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
const variance=a=>a.reduce((s,x)=>s+(x-mean(a))**2,0)/(a.length-1);
const covariance=(a,b)=>a.reduce((s,x,i)=>s+(x-mean(a))*(b[i]-mean(b)),0)/(a.length-1);
const annualized=a=>mean(a)*12;
const quantile=(sorted,p)=>{const x=(sorted.length-1)*p,l=Math.floor(x),h=Math.ceil(x);return sorted[l]+(sorted[h]-sorted[l])*(x-l);};
const round=x=>Number.isFinite(x)?Number(x.toFixed(8)):null;
function nwStandardError(values,lag=6){
  const n=values.length,mu=mean(values),centered=values.map(x=>x-mu);
  let spectral=centered.reduce((s,x)=>s+x*x,0)/n;
  for(let k=1;k<=Math.min(lag,n-1);k++){
    let gamma=0;for(let t=k;t<n;t++)gamma+=centered[t]*centered[t-k];
    spectral+=2*(1-k/(lag+1))*gamma/n;
  }
  return Math.sqrt(Math.max(0,spectral/n))*12;
}
function checkRows(rows){
  if(!Array.isArray(rows)||rows.length<36||rows.length>2400)throw Object.assign(new Error('Provide 36 to 2400 monthly observations'),{statusCode:400});
  const dates=new Set(),sorted=[...rows].sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  for(const row of sorted){
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(row.date)||dates.has(row.date))throw Object.assign(new Error('Dates must be unique YYYY-MM'),{statusCode:400});
    dates.add(row.date);
    for(const field of ['marketExcess','MOMENTUM','VALUE','SIZE_SMALL_CAP']){
      if(!finite(row[field])||Math.abs(row[field])>1)throw Object.assign(new Error('Invalid monthly decimal return: '+field),{statusCode:400});
    }
  }
  const start=Number(sorted[0].date.slice(0,4))*12+Number(sorted[0].date.slice(5));
  sorted.forEach((r,i)=>{const m=Number(r.date.slice(0,4))*12+Number(r.date.slice(5));if(m!==start+i)throw Object.assign(new Error('Monthly observations must be contiguous'),{statusCode:400});});
  return sorted;
}
function validateHistoricalFactorPremiums({rows,source,definition,benchmark,currency,asOf}={}){
  if(!source||!definition||!benchmark||!currency||!asOf)throw Object.assign(new Error('source, definition, benchmark, currency and asOf are required'),{statusCode:400});
  if(definition!=='long_short_excess')throw Object.assign(new Error('Only documented long_short_excess factor series are accepted; ETF total returns are not factor premiums'),{statusCode:400});
  const sorted=checkRows(rows);
  const market=sorted.map(r=>r.marketExcess),n=sorted.length;
  const target={MOMENTUM:.035,VALUE:.012,SIZE_SMALL_CAP:.01};
  const factors=FACTORS.map(code=>{
    const x=sorted.map(r=>r[code]),beta=covariance(x,market)/variance(market);
    const alpha=x.map((v,i)=>v-beta*market[i]),premium=annualized(x);
    const se=nwStandardError(x),z=(premium-target[code])/se;
    const windows=[];for(let i=120;i<=n;i++)windows.push(annualized(x.slice(i-120,i)));
    const confidence95=[round(premium-1.96*se),round(premium+1.96*se)];
    // This is a statistical compatibility screen, not proof of factor definition or future premium.
    const compatible=target[code]>=confidence95[0]&&target[code]<=confidence95[1];
    return {code,observations:n,modelAnnualPremium:target[code],historicalAnnualPremium:round(premium),
      annualVolatility:round(Math.sqrt(variance(x)*12)),marketBeta:round(beta),
      marketCorrelation:round(covariance(x,market)/Math.sqrt(variance(x)*variance(market))),
      regressionAnnualAlpha:round(annualized(alpha)),hacAnnualSe:round(se),
      confidence95,modelVsHistoricalZ:round(z),rolling10Year:windows.length?{
        windows:windows.length,median:round(quantile([...windows].sort((a,b)=>a-b),.5)),
        min:round(Math.min(...windows)),max:round(Math.max(...windows))
      }:null,compatibility:compatible?'COMPATIBLE_WITH_SAMPLE':'REVIEW',
      status:'REVIEW',notes:'Statistical compatibility is not forward-looking validation; factor definition, data quality, regime classification and external replication remain necessary.'};
  });
  return {version:6,phase:'HISTORICAL_FACTOR_VALIDATION',readOnly:true,status:'REVIEW_REQUIRED',
    provenance:{source,definition,benchmark,currency,asOf,from:sorted[0].date,to:sorted[n-1].date,observations:n},
    methodology:{unit:'decimal monthly excess returns',annualMean:'arithmetic ×12',annualVolatility:'sample std × sqrt(12)',
      uncertainty:'Newey-West HAC lag 6, normal 95% interval',rolling:'overlapping 120-month windows',
      regression:'factor monthly excess ~ intercept + beta × market monthly excess'},
    factors,regimes:{status:'NOT_VALIDATED',reason:'No independently dated and sourced macro-regime labels supplied'},
    checks:[{id:'DATA_CONTIGUOUS',status:'PASS'},{id:'INCREMENTAL_PREMIUM_DEFINITION',status:'USER_DECLARED_NOT_INDEPENDENTLY_VERIFIED'},
      {id:'FACTOR_REPLICATION',status:'UNVERIFIED'},{id:'DOUBLE_COUNTING_EXCLUDED',status:'UNVERIFIED'}]};
}
module.exports={validateHistoricalFactorPremiums};
