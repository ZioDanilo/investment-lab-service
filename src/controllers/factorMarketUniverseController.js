const { FactorMarketUniverseService } = require('../services/factorMarketUniverseService');
const respond = (res, data) => res.json({ success: true, data });
const readiness = async (req,res,next) => { try { return respond(res, await FactorMarketUniverseService.getReadiness()); } catch(e) { return next(e); } };
const preview = async (req,res,next) => { try { return respond(res, await FactorMarketUniverseService.preview()); } catch(e) { return next(e); } };
const sample = async (req,res,next) => { try { return respond(res, await FactorMarketUniverseService.generateSample(req.body || {})); } catch(e) { return next(e); } };
const statisticalTest = async (req,res,next) => { try { return respond(res, await FactorMarketUniverseService.statisticalTest(req.body || {})); } catch(e) { return next(e); } };
module.exports = { readiness, preview, sample, statisticalTest };
