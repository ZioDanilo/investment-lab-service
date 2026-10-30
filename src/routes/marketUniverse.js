const express = require('express');
const router = express.Router();
const requireAdminRole = require('../middleware/requireAdminRole');
const marketUniverseController = require('../controllers/marketUniverseController');


// Read-only diagnostic: does not regenerate or modify the Market Universe.
router.get('/v2/monte-carlo-diagnostics', marketUniverseController.getMonteCarloDiagnostics);
router.get('/v2/factor-audit', marketUniverseController.getFactorAudit);
router.get('/v2/return-calibration', marketUniverseController.getReturnCalibrationV6);
// Historical samples are supplied explicitly; validation never writes to the DB.
router.post('/v2/historical-factor-validation', requireAdminRole, marketUniverseController.validateHistoricalFactorPremiumsV6);

// V2 is the only Market Universe generation and projection API.
router.get('/v2/generation-status', marketUniverseController.getMarketUniverseV2GenerationStatus);
router.post('/v2/regenerate', requireAdminRole, marketUniverseController.regenerateMarketUniverseV2);
router.post('/v2/portfolio/projection/binary', marketUniverseController.buildBinaryPortfolioProjectionV2);

module.exports = router;
