const { MarketUniverseService } = require('../services/marketUniverseService');
const { MarketUniverseV2Service } = require('../services/marketUniverseV2Service');

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
    const start = await MarketUniverseService.startMarketUniverseRegeneration();
    return res.status(202).json({
      success: true,
      data: start
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

const buildBinaryPortfolioProjectionFromActiveMarketUniverse = async (req, res, next) => {
  try {
    const payload = await MarketUniverseService.buildBinaryPortfolioProjection(req.body || {});
    res.setHeader('X-Market-Universe-Run-Id', String(payload.runId || ''));
    res.setHeader('X-Market-Universe-Version', String(payload.version || 1));
    res.setHeader('X-Market-Universe-Payload-Type', String(payload.payloadType || 'FULL'));
    res.setHeader('X-Market-Universe-Path-Count', String(payload.pathCount || 0));
    res.setHeader('X-Market-Universe-Month-Count', String(payload.monthCount || 0));
    return res.status(200).type('application/octet-stream').send(payload.buffer);
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 500;
    return res.status(statusCode).json({
      success: false,
      code: error?.code || 'ACTIVE_MARKET_UNIVERSE_BINARY_PROJECTION_FAILED',
      error: error?.message || 'Binary portfolio projection from active Market Universe failed'
    });
  }
};

const getMarketUniverseGenerationStatus = async (req, res, next) => {
  try {
    const status = await MarketUniverseService.getGenerationStatus();
    return res.status(200).json({ success: true, data: status });
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 500;
    return res.status(statusCode).json({
      success: false,
      code: error?.code || 'MARKET_UNIVERSE_GENERATION_STATUS_FAILED',
      error: error?.message || 'Market Universe generation status request failed'
    });
  }
};

const getActiveMarketUniverseCacheStatus = async (req, res, next) => {
  try {
    const status = await MarketUniverseService.getActiveUniverseCacheStatus();
    return res.status(200).json({ success: true, data: status });
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 500;
    return res.status(statusCode).json({
      success: false,
      code: error?.code || 'ACTIVE_MARKET_UNIVERSE_CACHE_STATUS_FAILED',
      error: error?.message || 'Active Market Universe cache status request failed'
    });
  }
};

const warmupActiveMarketUniverseCache = async (req, res, next) => {
  try {
    const status = await MarketUniverseService.warmupActiveUniverseCache();
    return res.status(200).json({ success: true, data: status });
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 500;
    return res.status(statusCode).json({
      success: false,
      code: error?.code || 'ACTIVE_MARKET_UNIVERSE_CACHE_WARMUP_FAILED',
      error: error?.message || 'Active Market Universe cache warm-up failed'
    });
  }
};

const regenerateMarketUniverseV2 = async (req, res) => {
  try {
    const data = await MarketUniverseV2Service.startRegeneration(req.body || {});
    return res.status(202).json({ success: true, data });
  } catch (error) {
    return res.status(Number(error?.statusCode) || 500).json({ success: false, code: error?.code || 'MARKET_UNIVERSE_V2_GENERATION_FAILED', error: error?.message || 'Market Universe V2 generation failed' });
  }
};

const getMarketUniverseV2GenerationStatus = async (req, res) => {
  try {
    return res.status(200).json({ success: true, data: await MarketUniverseV2Service.getGenerationStatus() });
  } catch (error) {
    return res.status(Number(error?.statusCode) || 500).json({ success: false, code: error?.code || 'MARKET_UNIVERSE_V2_STATUS_FAILED', error: error?.message || 'Market Universe V2 status failed' });
  }
};

const buildBinaryPortfolioProjectionV2 = async (req, res) => {
  try {
    const payload = await MarketUniverseV2Service.buildBinaryPortfolioProjection(req.body || {});
    res.setHeader('X-Market-Universe-Run-Id', String(payload.runId || ''));
    res.setHeader('X-Market-Universe-Version', '2');
    res.setHeader('X-Market-Universe-Payload-Type', 'FULL');
    res.setHeader('X-Market-Universe-Path-Count', String(payload.pathCount || 0));
    res.setHeader('X-Market-Universe-Month-Count', String(payload.monthCount || 0));
    if (payload.telemetry) {
      res.setHeader('Server-Timing', [
        `activeRun;dur=${payload.telemetry.activeRunMs}`,
        `db;dur=${payload.telemetry.dbReadMs}`,
        `aggregate;dur=${payload.telemetry.aggregateMs}`,
        `macro;dur=${payload.telemetry.macroDecodeMs}`,
        `encode;dur=${payload.telemetry.binaryEncodeMs}`,
        `total;dur=${payload.telemetry.totalMs}`
      ].join(', '));
      res.setHeader('X-MU-V2-Selected-Assets', String(payload.telemetry.selectedAssetCount || 0));
      res.setHeader('X-MU-V2-Bytes-Read', String(payload.telemetry.bytesRead || 0));
      res.setHeader('X-MU-V2-Response-Bytes', String(payload.telemetry.responseBytes || payload.buffer?.length || 0));
    }
    return res.status(200).type('application/octet-stream').send(payload.buffer);
  } catch (error) {
    return res.status(Number(error?.statusCode) || 500).json({ success: false, code: error?.code || 'MARKET_UNIVERSE_V2_PROJECTION_FAILED', error: error?.message || 'Market Universe V2 projection failed' });
  }
};

module.exports = {
  getAllAssets,
  getAssetById,
  getAssetByIsin,
  regenerateMarketUniverse,
  getActiveMarketUniverse,
  buildPortfolioProjectionFromActiveMarketUniverse,
  buildBinaryPortfolioProjectionFromActiveMarketUniverse,
  getMarketUniverseGenerationStatus,
  getActiveMarketUniverseCacheStatus,
  warmupActiveMarketUniverseCache,
  regenerateMarketUniverseV2,
  getMarketUniverseV2GenerationStatus,
  buildBinaryPortfolioProjectionV2
};
