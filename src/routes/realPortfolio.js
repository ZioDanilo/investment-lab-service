const express = require('express');
const router = express.Router();
const realPortfolioController = require('../controllers/realPortfolioController');
const currentUser = require('../middleware/currentUser');

router.use(currentUser);

router.get('/', realPortfolioController.getRealPortfolios);
router.post('/', realPortfolioController.createRealPortfolio);
router.get('/market-values', realPortfolioController.getMarketValueSummaries);
router.get('/:id/holdings', realPortfolioController.getHoldings);
router.get('/:id/market-value', realPortfolioController.getMarketValueSummary);
router.get('/:id/operations/latest', realPortfolioController.getLatestOperations);
router.get('/:id/operations', realPortfolioController.getOperations);
router.post('/:id/operations', realPortfolioController.createOperation);
router.delete('/:id', realPortfolioController.deleteRealPortfolio);

module.exports = router;
