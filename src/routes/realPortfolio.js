const express = require('express');
const router = express.Router();
const realPortfolioController = require('../controllers/realPortfolioController');

router.get('/', realPortfolioController.getRealPortfolios);
router.post('/', realPortfolioController.createRealPortfolio);

module.exports = router;
