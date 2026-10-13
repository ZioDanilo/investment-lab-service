const { sequelize } = require('../config/database');
const ETF = require('../models/ETF');
const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const valid = v => typeof v === 'number' && Number.isFinite(v) && v > 0;
const dateOf = (seconds, zone) => {
  const parts = new Intl.DateTimeFormat('en-GB', {timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(seconds*1000));
  const p = Object.fromEntries(parts.map(x=>[x.type,x.value]));
  return p.year+'-'+p.month+'-'+p.day;
};
const median = values => {
  const a = values.filter(valid).sort((x,y)=>x-y);
  return a.length ? (a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2 : null;
};
const symbolOf = etf => {
  const ticker=String(etf.ticker||'').trim().toUpperCase();
  const market=String(etf.marketCode||'').trim().toUpperCase();
  if (!/^[A-Z0-9^._=-]{1,40}$/.test(ticker)||!/^[A-Z]{1,10}$/.test(market)) throw new Error('Invalid Yahoo ticker/marketCode');
  return ticker.endsWith('.'+market)?ticker:ticker.replace(/\.[A-Z]{1,10}$/,'')+'.'+market;
};
async function fetchChart(symbol, range) {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try {
    const response=await fetch(BASE+encodeURIComponent(symbol)+'?range='+range+'&interval=1d&events=splits',
      {signal:controller.signal,headers:{'User-Agent':'Mozilla/5.0',Accept:'application/json'}});
    if(!response.ok) throw new Error('Yahoo HTTP '+response.status);
    const payload=await response.json(),chart=payload?.chart?.result?.[0];
    if(!chart||String(chart.meta?.symbol||'').toUpperCase()!==symbol) throw new Error('Yahoo symbol mismatch: '+symbol);
    return chart;
  } finally {clearTimeout(timer);}
}
async function updateEtf(etf,{historical=false}={}) {
  const symbol=symbolOf(etf),chart=await fetchChart(symbol,historical?'2y':'10d');
  const zone=chart.meta?.exchangeTimezoneName||'Europe/Rome';
  const now=Math.floor(Date.now()/1000),today=dateOf(now,zone);
  const marketEnd=chart.meta?.currentTradingPeriod?.regular?.end;
  const unfinished=!Number.isFinite(marketEnd)||now<marketEnd;
  const quotes=chart.indicators?.quote?.[0]||{},byDate=new Map();
  let skipped=0;
  for(let i=0;i<(chart.timestamp||[]).length;i++){
    const stamp=chart.timestamp[i];
    if(!Number.isFinite(stamp)||stamp>now){skipped++;continue;}
    const date=dateOf(stamp,zone);
    const price=date===today&&unfinished
      ? (valid(chart.meta?.regularMarketPrice)?chart.meta.regularMarketPrice:quotes.open?.[i])
      : quotes.close?.[i];
    if(!valid(price)){skipped++;continue;}
    byDate.set(date,{date,quotation:price});
  }
  const candidates=[...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date));
  const [stored]=await sequelize.query(
    'SELECT date,quotation FROM etf_quotations WHERE isin=:isin AND quotation>0 ORDER BY date',
    {replacements:{isin:etf.isin}});
  const known=new Map(stored.map(r=>[String(r.date).slice(0,10),Number(r.quotation)]));
  const globalBaseline=median([...known.values()])??median(candidates.map(r=>r.quotation));
  const rejected=[],accepted=[];
  for(const row of candidates){
    const near=[...known.entries()].sort((a,b)=>
      Math.abs(Date.parse(a[0])-Date.parse(row.date))-Math.abs(Date.parse(b[0])-Date.parse(row.date)))
      .slice(0,10).map(x=>x[1]);
    const reference=median(near)??globalBaseline;
    if(reference&&(row.quotation/reference>3||row.quotation/reference<1/3)){
      rejected.push({isin:etf.isin,symbol,date:row.date,quotation:row.quotation,reference,
        reason:'extreme_price_ratio_requires_review',possibleCorporateAction:Boolean(Object.keys(chart.events?.splits||{}).length)});
    }else accepted.push(row);
  }
  // Do not write a new quote if a suspicious price was returned.
  // Historical values are inserted only when absent. The latest market session
  // is refreshed on each explicit request without a separate DELETE.
  const latest=candidates.at(-1)?.date;
  const [written]=accepted.length?await sequelize.query(`
    INSERT INTO etf_quotations (id,isin,date,quotation,source,"createdAt","updatedAt")
    SELECT gen_random_uuid(),:isin,r.date,r.quotation,'yahoo_chart',NOW(),NOW()
    FROM jsonb_to_recordset(CAST(:rows AS jsonb)) AS r(date date,quotation numeric)
    ON CONFLICT (isin,date) DO UPDATE
    SET quotation=EXCLUDED.quotation,source=EXCLUDED.source,"updatedAt"=NOW()
    WHERE etf_quotations.date=:latest
    RETURNING date,quotation,(xmax=0) AS was_inserted
  `,{replacements:{isin:etf.isin,rows:JSON.stringify(accepted),latest}}):[[]];
  const current=written.find(r=>String(r.date).slice(0,10)===latest)||
    (accepted.length?accepted[accepted.length-1]:null);
  return {isin:etf.isin,name:etf.name,ticker:etf.ticker,symbol,
    quotation:current?.quotation==null?null:Number(current.quotation),date:current?.date||null,
    inserted:written.filter(r=>r.was_inserted).length,updated:written.filter(r=>!r.was_inserted).length,
    existing:accepted.length-written.length,skipped,rejected,received:candidates.length};
}
async function updateAll({historical=false,etfs=null}={}){
  const targets=etfs||await ETF.findAll({attributes:['isin','name','ticker','marketCode'],raw:true});
  const results=[],failures=[],rejectedPrices=[];
  // Bounded concurrency: avoid one slow Yahoo request blocking all ETFs.
  const concurrency=4;
  let cursor=0;
  await Promise.all(Array.from({length:Math.min(concurrency,targets.length)},async()=>{
    while(cursor<targets.length){
      const etf=targets[cursor++];
      try{
        const result=await updateEtf(etf,{historical});
        results.push(result);
        rejectedPrices.push(...result.rejected);
      }catch(error){
        failures.push({isin:etf.isin,error:String(error.message||error)});
      }
    }
  }));
  return {success:failures.length===0,totalEtfs:targets.length,processed:results.length,
    inserted:results.reduce((n,r)=>n+r.inserted,0),updatedToday:results.reduce((n,r)=>n+r.updated,0),
    existing:results.reduce((n,r)=>n+r.existing,0),skippedPrices:results.reduce((n,r)=>n+r.skipped,0),
    rejectedPrices,failures,results};
}
module.exports={updateEtf,updateAll,symbolOf};
