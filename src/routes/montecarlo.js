const express = require('express');
const router = express.Router();
const monteCarloController = require('../controllers/monteCarloController');

/**
 * GET /api/monte-carlo/config
 * Retrieves Monte Carlo configuration (structural probabilities and transition matrix)
 */
router.get('/config', monteCarloController.getConfig);
router.post('/snapshot', monteCarloController.getSnapshot);

module.exports = router;
