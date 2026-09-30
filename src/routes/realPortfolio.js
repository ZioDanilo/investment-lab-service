const express = require('express');
const router = express.Router();
const realPortfolioController = require('../controllers/realPortfolioController');

router.get('/', realPortfolioController.getRealPortfolios);
router.post('/', realPortfolioController.createRealPortfolio);
router.delete('/:id', realPortfolioController.deleteRealPortfolio);

module.exports = router;
