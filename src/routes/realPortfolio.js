const express = require('express');
const router = express.Router();
const realPortfolioController = require('../controllers/realPortfolioController');

router.get('/', realPortfolioController.getRealPortfolios);

module.exports = router;
