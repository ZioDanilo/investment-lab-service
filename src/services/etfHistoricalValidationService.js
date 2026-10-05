const annualizedVolatility = values => {
  if (values.length < 2) return null;
  const mean = values.reduce((a,b) => a+b, 0) / values.length;
  const variance = values.reduce((s,x) => s + (x-mean)**2, 0) / (values.length-1);
  return Math.sqrt(Math.max(0, variance)) * Math.sqrt(12);
};

const cagr = values => {
  if (!values.length) return null;
  const wealth = values.reduce((w,r) => w * (1+r), 1);
  return wealth > 0 ? Math.pow(wealth, 12 / values.length) - 1 : -1;
};

const maxDrawdown = values => {
  let wealth=1, peak=1, worst=0;
  for (const r of values) {
    wealth *= 1+r; peak=Math.max(peak,wealth);
    worst=Math.min(worst, wealth/peak-1);
  }
  return worst;
};

const correlation = (a,b) => {
  if (a.length < 2 || a.length !== b.length) return null;
  const ma=a.reduce((x,y)=>x+y,0)/a.length, mb=b.reduce((x,y)=>x+y,0)/b.length;
  let cov=0, va=0, vb=0;
  for(let i=0;i<a.length;i+=1){const da=a[i]-ma, db=b[i]-mb;cov+=da*db;va+=da*da;vb+=db*db;}
  return va>0&&vb>0 ? cov/Math.sqrt(va*vb) : null;
};

const rSquared = (real, model) => {
  if (real.length < 2) return null;
  const mean=real.reduce((a,b)=>a+b,0)/real.length;
  const ssTot=real.reduce((s,x)=>s+(x-mean)**2,0);
  const ssRes=real.reduce((s,x,i)=>s+(x-model[i])**2,0);
  return ssTot>0 ? 1-ssRes/ssTot : null;
};

const validateRows = rows => {
  if (!Array.isArray(rows) || rows.length < 2) {
    const e=new Error('Historical validation requires at least 2 aligned monthly observations'); e.statusCode=422; throw e;
  }
  return rows.map((row,index) => {
    const real=Number(row.realReturn), model=Number(row.modelReturn);
    if (!Number.isFinite(real)||!Number.isFinite(model)||real<=-1||model<=-1) {
      const e=new Error('Historical validation contains an invalid monthly return'); e.statusCode=422; e.details={index,row}; throw e;
    }
    return { date: row.date ?? null, real, model };
  });
};

class EtfHistoricalValidationService {
  static evaluate({ etfId=null, isin=null, rows=[] }={}) {
    const aligned=validateRows(rows);
    const real=aligned.map(x=>x.real), model=aligned.map(x=>x.model);
    const residual=real.map((x,i)=>x-model[i]);
    const corr=correlation(real,model);
    return {
      etfId, isin, status:'diagnostic_only',
      historicalObservations:aligned.length,
      rSquared:rSquared(real,model),
      returnCorrelation:corr,
      realVolatility:annualizedVolatility(real),
      modelVolatility:annualizedVolatility(model),
      residualVolatility:annualizedVolatility(residual),
      trackingError:annualizedVolatility(residual),
      realCagr:cagr(real), modelCagr:cagr(model),
      realMaxDrawdown:maxDrawdown(real), modelMaxDrawdown:maxDrawdown(model),
      meanMonthlyError:residual.reduce((a,b)=>a+b,0)/residual.length,
      validationWindow:{from:aligned[0].date,to:aligned[aligned.length-1].date},
      readyDecision:null,
      note:'Diagnostic only: no READY/REVIEW_REQUIRED decision is made until historical data sources and acceptance thresholds are approved.'
    };
  }
}
module.exports={EtfHistoricalValidationService};
