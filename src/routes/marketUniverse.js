const express = require('express');
const router = express.Router();
const marketUniverseController = require('../controllers/marketUniverseController');

router.get('/assets', marketUniverseController.getAllAssets);
router.get('/assets/id/:id', marketUniverseController.getAssetById);
router.get('/assets/isin/:isin', marketUniverseController.getAssetByIsin);
router.get('/active', marketUniverseController.getActiveMarketUniverse);
router.post('/portfolio/projection', marketUniverseController.buildPortfolioProjectionFromActiveMarketUniverse);
router.post('/regenerate', marketUniverseController.regenerateMarketUniverse);

module.exports = router;
