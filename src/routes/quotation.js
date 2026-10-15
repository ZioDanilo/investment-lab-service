const express = require('express');
const router = express.Router();
const quotationController = require('../controllers/quotationController');
const currentUser = require('../middleware/currentUser');

router.post('/real-portfolio/:portfolioId/refresh', currentUser, quotationController.refreshRealPortfolioQuotations);

// Get daily quotations (check DB for today, fetch from API if needed)
router.get('/daily', quotationController.getDailyQuotations);

// Get quotation history for a specific ETF
router.get('/history', quotationController.getQuotationHistory);

// Force refresh - Yahoo Finance only
router.post('/force-refresh', quotationController.forceRefreshQuotations);

// Refresh single ETF quotation
router.post('/refresh-single', quotationController.refreshSingleQuotation);
// Targeted Yahoo Finance refresh for the rebalance table.
router.post('/single/:isin/refresh', currentUser, (req, res, next) => {
  req.query.isin = String(req.params.isin || '').trim().toUpperCase();
  return quotationController.refreshSingleQuotation(req, res, next);
});

module.exports = router;
