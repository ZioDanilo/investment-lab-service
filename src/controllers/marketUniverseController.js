const { MarketUniverseV2Service } = require('../services/marketUniverseV2Service');

const getFactorAudit = async (req, res) => {
  try {
    const data = await MarketUniverseV2Service.getFactorAudit();
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(Number(error?.statusCode) || 500).json({
      success: false,
      code: error?.code || 'FACTOR_AUDIT_FAILED',
      error: error?.message || 'Factor audit failed'
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
  getFactorAudit,
  regenerateMarketUniverseV2,
  getMarketUniverseV2GenerationStatus,
  buildBinaryPortfolioProjectionV2
};
