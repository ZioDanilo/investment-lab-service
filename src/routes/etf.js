const express = require('express');
const router = express.Router();
const etfController = require('../controllers/etfController');

router.get('/', etfController.getETFs);
router.get('/:id', etfController.getETFById);
router.post('/', etfController.createETF);
router.post('/add', etfController.addEtf);
router.put('/:id', etfController.updateETF);

module.exports = router;
