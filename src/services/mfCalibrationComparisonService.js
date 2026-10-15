const { Op } = require('sequelize');
const MarketUniverseRunV2 = require('../models/MarketUniverseRunV2');
const MarketUniverseEtfV2 = require('../models/MarketUniverseEtfV2');

const RUNS = {
  intermediate: '52d06460-805f-4223-a83e-709f20ee65c3',
  previous: 'eb8984c0-a5ad-409f-a407-709dd6be6f2f'
};
const ISINS = {
  mf: 'LU3307218399',
  world: 'IE00B4L5Y983',
  quality: 'IE00BP3QZ601'
};
const round = (n) => Number.isFinite(n) ? Number(n.toFixed(6)) : null;
function vector(blob, count) {
  const buffer = Buffer.from(blob);
  if (buffer.length !== count * 4) throw new Error('Invalid Float32 buffer length');
  const data = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    data[i] = buffer.readFloatLE(i * 4);
    if (!Number.isFinite(data[i]) || data[i] <= -1) throw new Error('Invalid monthly return at index ' + i);
  }
  return data;
}
function mean(a) { let s = 0; for (const v of a) s += v; return a.length ? s / a.length : null; }
function percentile(a, p) {
  if (!a.length) return null;
  const sorted = Array.from(a).sort((x, y) => x - y);
  return sorted[Math.floor((sorted.length - 1) * p)];
}
function corr(x, y, indices) {
  const n = indices.length;
  if (n < 3) return null;
  let sx=0,sy=0,sxx=0,syy=0,sxy=0;
  for (const i of indices) { const a=x[i],b=y[i]; sx+=a;sy+=b;sxx+=a*a;syy+=b*b;sxy+=a*b; }
  const den=Math.sqrt((n*sxx-sx*sx)*(n*syy-sy*sy));
  return den > 0 ? round((n*sxy-sx*sy)/den) : null;
}
function metrics(a) {
  const n=a.length, avg=mean(a);
  let variance=0, positive=0, logSum=0;
  for (const v of a) { variance+=(v-avg)**2; if(v>0)positive++; logSum+=Math.log1p(v); }
  const cutoff=percentile(a,0.05);
  let es=0,k=0;
  for(const v of a) if(v<=cutoff){es+=v;k++;}
  return { observations:n, meanMonthly:round(avg), geometricAnnualized:round(Math.expm1(logSum/n*12)), annualizedVolatility:round(Math.sqrt(variance/(n-1)*12)), positiveMonthsPct:round(positive/n*100), monthlyP5:round(cutoff), expectedShortfall5:round(es/k) };
}
function tail(mf, equity) {
  const n=equity.length, threshold=percentile(equity,0.05);
  const indices=[];
  for(let i=0;i<n;i++) if(equity[i]<=threshold)indices.push(i);
  let positive=0, sum=0;
  for(const i of indices){sum+=mf[i];if(mf[i]>0)positive++;}
  return { observations:indices.length, equityThreshold:round(threshold), mfMean:round(sum/indices.length), mfPositivePct:round(positive/indices.length*100), conditionalCorrelation:corr(mf,equity,indices) };
}
function portfolios(assets, paths, months) {
  const specs={world100:{world:1},world80_mf20:{world:0.8,mf:0.2},world80_quality20:{world:0.8,quality:0.2}};
  const output={};
  for(const [name,weights] of Object.entries(specs)){
    const cagr=[],dd=[],vol=[],positive=[];
    for(let p=0;p<paths;p++){
      const capital={};for(const k of Object.keys(weights))capital[k]=weights[k];
      let peak=1, maxDd=0, previous=1, sum=0,sq=0;
      for(let t=0;t<months;t++){
        if(t>0&&t%12===0){const total=Object.values(capital).reduce((a,b)=>a+b,0);for(const k of Object.keys(capital))capital[k]=total*weights[k];}
        for(const k of Object.keys(capital))capital[k]*=1+assets[k][p*months+t];
        const total=Object.values(capital).reduce((a,b)=>a+b,0);
        const r=total/previous-1;sum+=r;sq+=r*r;previous=total;
        peak=Math.max(peak,total);maxDd=Math.max(maxDd,1-total/peak);
      }
      cagr.push(Math.pow(previous,12/months)-1);dd.push(maxDd);
      vol.push(Math.sqrt(Math.max(0,(sq-sum*sum/months)/(months-1))*12));
      positive.push(previous>1);
    }
    output[name]={paths,cagrMedian:round(percentile(cagr,0.5)),volatilityMedian:round(percentile(vol,0.5)),maxDrawdownMedian:round(percentile(dd,0.5)),maxDrawdownP95:round(percentile(dd,0.95)),positiveAt30YearsPct:round(positive.filter(Boolean).length/paths*100)};
  }
  return output;
}
async function compare(req,res) {
  const started=Date.now();
  try{
    const runIds=Object.values(RUNS);
    const runs=await MarketUniverseRunV2.findAll({where:{runId:{[Op.in]:runIds}},raw:true});
    const byId=new Map(runs.map(r=>[r.runId,r]));
    if(runs.length!==2) return res.status(409).json({success:false,error:'Both MU runs must exist'});
    const rows=await MarketUniverseEtfV2.findAll({where:{runId:{[Op.in]:runIds},isin:{[Op.in]:[...new Set(Object.values(ISINS))]}},raw:true});
    const data={};const integrity={};
    for(const [name,id] of Object.entries(RUNS)){
      const run=byId.get(id),count=Number(run.pathCount)*Number(run.monthCount);
      if(count!==360000)throw new Error('Unexpected run dimensions');
      data[name]={};integrity[name]={status:run.status,seed:run.seed,pathCount:run.pathCount,monthCount:run.monthCount,hasScenarios:!!run.scenarioBinary,hasIntensities:!!run.intensityBinary};
      for(const [key,isin] of Object.entries(ISINS)){
        const row=rows.find(r=>r.runId===id&&r.isin===isin);
        if(!row||row.valueCount!==count)throw new Error('Missing/incomplete vector '+name+' '+key);
        data[name][key]=vector(row.returnsBinary,count);
      }
    }
    const references={};
    for(const key of ['world','quality']){
      const a=data.previous[key],b=data.intermediate[key];let changed=0,maxDifference=0;
      for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);if(d>0)changed++;if(d>maxDifference)maxDifference=d;}
      references[key]={differentMonths:changed,maxAbsoluteDifference:round(maxDifference)};
    }
    const result={diagnostic:'managed_futures_calibration_comparison',runActive:RUNS.intermediate,runPrevious:RUNS.previous,integrity,references,etfMetrics:{},tailRisk:{},portfolioComparison:{},warnings:['Previous run status FAILED and has no scenario/intensity vectors: exploratory comparison only.','Run calibration parameters are not persisted with the binary vectors.','Momentum not included: its ISIN is not confirmed in the current MU.']};
    for(const name of Object.keys(RUNS)){
      const d=data[name];
      result.etfMetrics[name]={};result.tailRisk[name]={};
      for(const key of ['mf','world','quality'])result.etfMetrics[name][key]=metrics(d[key]);
      for(const key of ['world','quality'])result.tailRisk[name][key]={...tail(d.mf,d[key]),overallCorrelation:corr(d.mf,d[key],Array.from({length:d.mf.length},(_,i)=>i))};
      result.portfolioComparison[name]=portfolios(d,1000,360);
    }
    result.executionTimeMs=Date.now()-started;
    return res.json({success:true,data:result});
  }catch(error){console.error('[MF comparison]',error);return res.status(500).json({success:false,error:error.message});}
}
module.exports={compare};
