const express = require('express');
const router = express.Router();
const realPortfolioController = require('../controllers/realPortfolioController');
const currentUser = require('../middleware/currentUser');

router.use(currentUser);

router.get('/', realPortfolioController.getRealPortfolios);
router.post('/', realPortfolioController.createRealPortfolio);
router.post('/:id/operations', realPortfolioController.createOperation);
router.delete('/:id', realPortfolioController.deleteRealPortfolio);

module.exports = router;
