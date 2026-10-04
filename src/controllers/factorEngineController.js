const { FactorEngineService } = require('../services/factorEngineService');

const listFactors = async (req, res, next) => {
  try {
    const data = await FactorEngineService.listFactors({ activeOnly: req.query.all !== 'true' });
    return res.json({ success: true, data });
  } catch (e) { return next(e); }
};

const getScenarioSnapshot = async (req, res, next) => {
  try {
    const data = await FactorEngineService.getScenarioSnapshot(req.params.scenario || 'general');
    return res.json({ success: true, data });
  } catch (e) { return next(e); }
};

const getEtfModel = async (req, res, next) => {
  try {
    const data = await FactorEngineService.getEtfModel(req.params.etfId);
    if (!data) return res.status(404).json({ success: false, error: 'ETF not found' });
    return res.json({ success: true, data });
  } catch (e) { return next(e); }
};

const upsertExposure = async (req, res, next) => {
  try {
    const data = await FactorEngineService.upsertExposure(req.params.etfId, req.params.factorId, req.body || {});
    return res.json({ success: true, data });
  } catch (e) { return next(e); }
};

const upsertCorrelation = async (req, res, next) => {
  try {
    const data = await FactorEngineService.upsertCorrelation(req.body || {});
    return res.json({ success: true, data });
  } catch (e) { return next(e); }
};

const getExposureWeights = async (req, res) => {
  const data = FactorEngineService.exposureWeightsForHistory(req.query.years);
  return res.json({ success: true, data });
};

module.exports = { listFactors, getScenarioSnapshot, getEtfModel, upsertExposure, upsertCorrelation, getExposureWeights };
