const express = require('express');
const router = express.Router();
const quotationController = require('../controllers/quotationController');
const currentUser = require('../middleware/currentUser');

router.post('/real-portfolio/:portfolioId/refresh', currentUser, quotationController.refreshRealPortfolioQuotations);

// Get daily quotations (check DB for today, fetch from API if needed)
router.get('/daily', quotationController.getDailyQuotations);

// Get quotation history for a specific ETF
router.get('/history', quotationController.getQuotationHistory);

// Delete today's quotations (for refresh)
router.delete('/today', quotationController.deleteTodayQuotations);

// Force refresh - Update ALL ETFs from JustETF, overwrite DB
router.post('/force-refresh', quotationController.forceRefreshQuotations);

// Refresh single ETF quotation
router.post('/refresh-single', quotationController.refreshSingleQuotation);

module.exports = router;
