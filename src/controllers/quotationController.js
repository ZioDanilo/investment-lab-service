const ETF=require('../models/ETF');
const EtfQuotation=require('../models/EtfQuotation');
const Portafoglio=require('../models/Portafoglio');
const RealPortfolioEtf=require('../models/RealPortfolioEtf');
const {Op}=require('sequelize');
const {updateEtf,updateAll}=require('../services/yahooQuotationService');
const noCache=res=>res.set('Cache-Control','no-store');
const latest=isin=>EtfQuotation.findOne({where:{isin,quotation:{[Op.ne]:null}},order:[['date','DESC']],raw:true});
exports.getQuotationHistory=async(req,res,next)=>{
  try{
    const isin=String(req.query.isin||'').trim().toUpperCase();
    if(!isin)return res.status(400).json({success:false,error:'ISIN obbligatorio'});
    const limit=Math.min(5000,Math.max(1,Number.parseInt(req.query.limit,10)||30));
    const data=await EtfQuotation.findAll({where:{isin},attributes:['isin','quotation','date'],order:[['date','DESC']],limit,raw:true});
    return noCache(res).json({success:true,data});
  }catch(error){next(error);}
};
const display=async res=>{
  const etfs=await ETF.findAll({attributes:['isin','name'],raw:true});
  const data=[];
  for(const etf of etfs){
    const rows=await EtfQuotation.findAll({where:{isin:etf.isin,quotation:{[Op.ne]:null}},order:[['date','DESC']],limit:2,raw:true});
    const current=rows[0],previous=rows[1];
    const variation=current&&previous&&Number(previous.quotation)>0
      ?(((Number(current.quotation)/Number(previous.quotation))-1)*100).toFixed(2)+'%':'-';
    data.push({isin:etf.isin,name:etf.name,quotation:current?Number(current.quotation):null,
      variation,date:current?.date||null});
  }
  return noCache(res).json({success:true,data,date:new Date().toISOString().slice(0,10)});
};
exports.getDailyQuotations=async(req,res,next)=>{
  try{await updateAll();return await display(res);}catch(error){next(error);}
};
exports.forceRefreshQuotations=exports.getDailyQuotations;
exports.refreshSingleQuotation=async(req,res,next)=>{
  try{
    const isin=String(req.params?.isin||req.query?.isin||req.body?.isin||'').trim().toUpperCase();
    if(!isin)return res.status(400).json({success:false,error:'ISIN obbligatorio'});
    const etf=await ETF.findOne({where:{isin},attributes:['isin','name','ticker','marketCode']});
    if(!etf)return res.status(404).json({success:false,error:'ETF non trovato'});
    const result=await updateEtf(etf);
    if(result.rejected.length)return res.status(422).json({success:false,error:'Yahoo quotation quarantined',rejectedPrices:result.rejected});
    const row=await latest(isin);
    return noCache(res).json({success:true,data:{isin,name:etf.name,ticker:etf.ticker,
      quotation:row?Number(row.quotation):null,date:row?.date||null,variation:'-'},
      date:row?.date||null,cached:false});
  }catch(error){return res.status(502).json({success:false,error:String(error.message||error)});}
};
exports.refreshRealPortfolioQuotations=async(req,res,next)=>{
  try{
    const portfolio=await Portafoglio.findOne({where:{id:req.params.portfolioId,userId:req.user.id,tipo:'reale',status:'open'}});
    if(!portfolio)return res.status(404).json({success:false,error:'Portafoglio reale non trovato'});
    const positions=await RealPortfolioEtf.findAll({where:{realPortfolioId:portfolio.id},
      include:[{model:ETF,as:'etf',attributes:['isin','name','nickname','ticker','marketCode']}]});
    const etfs=[...new Map(positions.map(p=>p.etf).filter(Boolean).map(e=>[e.isin,e])).values()];
    const data=[],failures=[];
    for(const etf of etfs){
      try{
        const result=await updateEtf(etf);
        const rejected=result.rejected.length>0;
        if(rejected)failures.push({isin:etf.isin,error:'Quotation quarantined',rejectedPrices:result.rejected});
        const row=await latest(etf.isin);
        data.push({isin:etf.isin,name:etf.name,nickname:etf.nickname,ticker:etf.ticker,
          quotation:row?Number(row.quotation):null,date:row?.date||null,
          diagnostic:{provider:'Yahoo Finance',symbol:result.symbol,fetchStatus:rejected?'rejected_price':'updated',
            providerCalled:true,providerCalledThisRequest:true,providerDate:result.date,providerPrice:result.quotation}});
      }catch(error){
        const message=String(error.message||error),row=await latest(etf.isin);
        failures.push({isin:etf.isin,error:message});
        data.push({isin:etf.isin,name:etf.name,nickname:etf.nickname,ticker:etf.ticker,
          quotation:row?Number(row.quotation):null,date:row?.date||null,
          diagnostic:{provider:'Yahoo Finance',fetchStatus:'error',providerCalled:true,error:message}});
      }
    }
    return noCache(res).json({success:failures.length===0,data,date:new Date().toISOString().slice(0,10),failures});
  }catch(error){next(error);}
};
