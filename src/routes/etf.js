const express = require('express');
const router = express.Router();
const etfController = require('../controllers/etfController');

// Specific routes first
router.get('/list/simple', etfController.getETFsSimple);
router.get('/list/all', etfController.getAllEtfs);
router.get('/search/justetf', etfController.searchOnJustETF);
router.post('/:isin/calibrate', etfController.calibrateETF);
router.delete('/:isin/delete', etfController.deleteEtf);

// Generic routes after
router.get('/', etfController.getETFs);
router.get('/:id', etfController.getETFById);
router.post('/', etfController.createETF);
router.post('/add', etfController.addEtf);
router.post('/add-with-correlations', etfController.addEtfWithCorrelations);
router.put('/:id', etfController.updateETF);

module.exports = router;
