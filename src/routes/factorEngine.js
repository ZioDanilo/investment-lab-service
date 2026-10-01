const express = require('express');
const router = express.Router();
const controller = require('../controllers/factorEngineController');
const universe = require('../controllers/factorMarketUniverseController');

router.get('/factors', controller.listFactors);
router.get('/universe/readiness', universe.readiness);
router.get('/universe/preview', universe.preview);
router.post('/universe/sample', universe.sample);
router.get('/scenarios/:scenario', controller.getScenarioSnapshot);
router.get('/etf/:etfId', controller.getEtfModel);
router.put('/etf/:etfId/exposures/:factorId', controller.upsertExposure);
router.put('/correlations', controller.upsertCorrelation);
router.get('/exposure-weights', controller.getExposureWeights);

module.exports = router;
