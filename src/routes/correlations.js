const express = require('express');
const router = express.Router();
const correlationController = require('../controllers/correlationController');

// POST /api/correlations - Save correlations from JSON payload
router.post('/', correlationController.saveCorrelations);

// GET /api/correlations?isin1=XXX - Get correlations
router.get('/', correlationController.getCorrelations);

module.exports = router;
