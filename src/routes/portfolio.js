const express = require('express');
const router = express.Router();
const portfolioController = require('../controllers/portfolioController');
const portafoglioController = require('../controllers/portafoglioController');

// Old portfolio endpoints
router.get('/old', portfolioController.getPortfolios);
router.get('/old/:id', portfolioController.getPortfolioById);
router.post('/old', portfolioController.createPortfolio);
router.put('/old/:id', portfolioController.updatePortfolio);
router.delete('/old/:id', portfolioController.deletePortfolio);

// New saved portfolios endpoints
router.get('/search-etf', portafoglioController.searchETF);
router.post('/', portafoglioController.savePortafoglio);
router.get('/', portafoglioController.getPortafogli);
router.get('/:id/kpi-targets', portafoglioController.getKpiTargets);
router.put('/:id/kpi-targets', portafoglioController.saveKpiTargets);
router.get('/:id', portafoglioController.getPortafoglioById);
router.put('/:id', portafoglioController.updatePortafoglio);
router.delete('/:id', portafoglioController.deletePortafoglio);

module.exports = router;
