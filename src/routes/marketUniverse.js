const express = require('express');
const router = express.Router();
const marketUniverseController = require('../controllers/marketUniverseController');

router.get('/assets', marketUniverseController.getAllAssets);
router.get('/assets/id/:id', marketUniverseController.getAssetById);
router.get('/assets/isin/:isin', marketUniverseController.getAssetByIsin);
// V2 is the only Market Universe generation and projection API.
router.get('/v2/generation-status', marketUniverseController.getMarketUniverseV2GenerationStatus);
router.post('/v2/regenerate', marketUniverseController.regenerateMarketUniverseV2);
router.post('/v2/portfolio/projection/binary', marketUniverseController.buildBinaryPortfolioProjectionV2);

module.exports = router;
