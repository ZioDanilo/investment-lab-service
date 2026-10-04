const express = require('express');
const router = express.Router();
const marketUniverseController = require('../controllers/marketUniverseController');

router.get('/assets', marketUniverseController.getAllAssets);
router.get('/assets/id/:id', marketUniverseController.getAssetById);
router.get('/assets/isin/:isin', marketUniverseController.getAssetByIsin);
router.get('/active', marketUniverseController.getActiveMarketUniverse);
router.get('/generation-status', marketUniverseController.getMarketUniverseGenerationStatus);
router.get('/cache/status', marketUniverseController.getActiveMarketUniverseCacheStatus);
router.post('/cache/warmup', marketUniverseController.warmupActiveMarketUniverseCache);
router.post('/portfolio/projection', marketUniverseController.buildPortfolioProjectionFromActiveMarketUniverse);
router.post('/portfolio/projection/binary', marketUniverseController.buildBinaryPortfolioProjectionFromActiveMarketUniverse);
router.post('/regenerate', marketUniverseController.regenerateMarketUniverse);
// V2 is intentionally isolated from the legacy Market Universe and its warm-up cache.
router.get('/v2/generation-status', marketUniverseController.getMarketUniverseV2GenerationStatus);
router.post('/v2/regenerate', marketUniverseController.regenerateMarketUniverseV2);
router.post('/v2/portfolio/projection/binary', marketUniverseController.buildBinaryPortfolioProjectionV2);

module.exports = router;
