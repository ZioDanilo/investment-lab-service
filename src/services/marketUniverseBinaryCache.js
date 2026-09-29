const MarketUniverseBinaryChunk = require('../models/MarketUniverseBinaryChunk');

const SCENARIOS = ['expansion', 'soft_landing', 'recession', 'stagflation', 'general'];

const persistBinaryCache = async (cache, withRetry) => {
  const pathsPerChunk = Math.max(1, Number(process.env.MARKET_UNIVERSE_BINARY_PATH_CHUNK_SIZE || 100));
  const scenarioCodes = new Map(SCENARIOS.map((value, index) => [value, index]));
  await MarketUniverseBinaryChunk.destroy({ where: { runId: cache.runId } });
  let chunkIndex = 0;

  for (let pathStart = 0; pathStart < cache.pathCount; pathStart += pathsPerChunk) {
    const pathEnd = Math.min(cache.pathCount, pathStart + pathsPerChunk);
    const monthStart = pathStart * cache.monthCount;
    const monthEnd = pathEnd * cache.monthCount;
    const returnStart = monthStart * cache.assetCount;
    const returnEnd = monthEnd * cache.assetCount;
    const scenarios = Buffer.alloc(monthEnd - monthStart);
    for (let i = monthStart; i < monthEnd; i += 1) scenarios[i - monthStart] = scenarioCodes.get(cache.scenarios[i]) ?? 255;

    const payload = {
      runId: cache.runId, chunkIndex, pathStart, pathCount: pathEnd - pathStart,
      returnsBinary: Buffer.from(cache.returns.subarray(returnStart, returnEnd).buffer,
        cache.returns.byteOffset + returnStart * 8, (returnEnd - returnStart) * 8),
      intensitiesBinary: Buffer.from(cache.intensities.subarray(monthStart, monthEnd).buffer,
        cache.intensities.byteOffset + monthStart * 8, (monthEnd - monthStart) * 8),
      scenariosBinary: scenarios
    };
    await withRetry('create-market-universe-binary-chunk', () => MarketUniverseBinaryChunk.create(payload));
    chunkIndex += 1;
  }
  return chunkIndex;
};

const loadBinaryCache = async (activeRun, startedAt) => {
  const chunks = await MarketUniverseBinaryChunk.findAll({
    where: { runId: activeRun.runId }, raw: true, order: [['chunkIndex', 'ASC']]
  });
  if (!chunks.length) return null;

  const pathCount = Number(activeRun.pathCount || 0);
  const monthCount = Number(activeRun.monthCount || 0);
  const assetCount = Number(activeRun.assetCount || 0);
  const returns = new Float64Array(pathCount * monthCount * assetCount);
  const intensities = new Float64Array(pathCount * monthCount);
  const scenarios = new Array(pathCount * monthCount);
  let loadedPaths = 0;

  for (const chunk of chunks) {
    const pathStart = Number(chunk.pathStart);
    const chunkPaths = Number(chunk.pathCount);
    const monthStart = pathStart * monthCount;
    const monthLength = chunkPaths * monthCount;
    const returnStart = monthStart * assetCount;
    const returnLength = monthLength * assetCount;
    const rb = Buffer.from(chunk.returnsBinary);
    const ib = Buffer.from(chunk.intensitiesBinary);
    const sb = Buffer.from(chunk.scenariosBinary);
    if (rb.length !== returnLength * 8 || ib.length !== monthLength * 8 || sb.length !== monthLength) {
      const error = new Error('Binary Market Universe chunk geometry mismatch');
      error.code = 'INVALID_BINARY_MARKET_UNIVERSE_GEOMETRY';
      error.statusCode = 409;
      throw error;
    }
    new Uint8Array(returns.buffer, returnStart * 8, rb.length).set(rb);
    new Uint8Array(intensities.buffer, monthStart * 8, ib.length).set(ib);
    for (let i = 0; i < monthLength; i += 1) scenarios[monthStart + i] = SCENARIOS[sb[i]] || '';
    loadedPaths += chunkPaths;
  }

  if (loadedPaths !== pathCount) {
    const error = new Error('Binary Market Universe path count mismatch');
    error.code = 'INVALID_BINARY_MARKET_UNIVERSE_GEOMETRY';
    error.statusCode = 409;
    throw error;
  }

  return {
    runId: activeRun.runId, pathCount, monthCount, assetCount,
    assetOrder: (activeRun.assetOrder || []).map((isin) => String(isin).trim().toUpperCase()),
    returns, scenarios, intensities, loadedAt: new Date().toISOString(),
    loadMs: Date.now() - startedAt, state: 'WARM'
  };
};

module.exports = { persistBinaryCache, loadBinaryCache };
