const express = require('express');
const router = express.Router();
const controller = require('../controllers/factorEngineController');

router.get('/factors', controller.listFactors);
router.get('/scenarios/:scenario', controller.getScenarioSnapshot);
router.get('/etf/:etfId', controller.getEtfModel);
router.put('/etf/:etfId/exposures/:factorId', controller.upsertExposure);
router.put('/correlations', controller.upsertCorrelation);
router.get('/exposure-weights', controller.getExposureWeights);

module.exports = router;
