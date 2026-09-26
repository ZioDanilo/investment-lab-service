const { MarketUniverseService } = require('../services/marketUniverseService');

const getAllAssets = async (req, res, next) => {
  try {
    const assets = await MarketUniverseService.getAllAssets();
    return res.status(200).json({ success: true, data: assets });
  } catch (error) {
    return next(error);
  }
};

const getAssetById = async (req, res, next) => {
  try {
    const asset = await MarketUniverseService.getAssetById(req.params.id);
    if (!asset) {
      return res.status(404).json({ success: false, error: 'Asset not found' });
    }
    return res.status(200).json({ success: true, data: asset });
  } catch (error) {
    return next(error);
  }
};

const getAssetByIsin = async (req, res, next) => {
  try {
    const asset = await MarketUniverseService.getAssetByIsin(req.params.isin);
    if (!asset) {
      return res.status(404).json({ success: false, error: 'Asset not found by ISIN' });
    }
    return res.status(200).json({ success: true, data: asset });
  } catch (error) {
    return next(error);
  }
};

const regenerateMarketUniverse = async (req, res, next) => {
  try {
    const result = await MarketUniverseService.regenerateMarketUniverse();
    return res.status(200).json({
      success: true,
      ...result
    });
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 500;
    return res.status(statusCode).json({
      success: false,
      code: error?.code || 'MARKET_UNIVERSE_READ_FAILED',
      error: error?.message || 'Market Universe regeneration failed'
    });
  }
};

const getActiveMarketUniverse = async (req, res, next) => {
  try {
    const run = await MarketUniverseService.getActiveMarketUniverseRun();
    return res.status(200).json({
      success: true,
      data: {
        runId: run.runId,
        generatedAt: run.generatedAt,
        status: run.status,
        active: run.active,
        pathCount: Number(run.pathCount),
        monthCount: Number(run.monthCount),
        assetCount: Number(run.assetCount),
        assetOrder: Array.isArray(run.assetOrder) ? run.assetOrder : []
      }
    });
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 500;
    return res.status(statusCode).json({
      success: false,
      code: error?.code || 'ACTIVE_MARKET_UNIVERSE_READ_FAILED',
      error: error?.message || 'Active Market Universe could not be loaded'
    });
  }
};

const buildPortfolioProjectionFromActiveMarketUniverse = async (req, res, next) => {
  try {
    const payload = await MarketUniverseService.buildPortfolioProjectionFromActiveMarketUniverse(req.body || {});
    return res.status(200).json({
      success: true,
      data: payload
    });
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 500;
    return res.status(statusCode).json({
      success: false,
      code: error?.code || 'ACTIVE_MARKET_UNIVERSE_PROJECTION_FAILED',
      error: error?.message || 'Portfolio projection from active Market Universe failed'
    });
  }
};

module.exports = {
  getAllAssets,
  getAssetById,
  getAssetByIsin,
  regenerateMarketUniverse,
  getActiveMarketUniverse,
  buildPortfolioProjectionFromActiveMarketUniverse
};
