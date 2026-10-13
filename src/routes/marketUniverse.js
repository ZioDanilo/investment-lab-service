const express = require('express');
const router = express.Router();
const requireAdminRole = require('../middleware/requireAdminRole');
const marketUniverseController = require('../controllers/marketUniverseController');

// V2 is the only Market Universe generation and projection API.
router.get('/v2/generation-status', marketUniverseController.getMarketUniverseV2GenerationStatus);
router.post('/v2/regenerate', requireAdminRole, marketUniverseController.regenerateMarketUniverseV2);
router.post('/v2/portfolio/projection/binary', marketUniverseController.buildBinaryPortfolioProjectionV2);

module.exports = router;
