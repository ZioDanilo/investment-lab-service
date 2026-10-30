const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

router.post('/login', authController.login);
router.post('/register', authController.register);
router.get('/username-availability', authController.checkUsername);
router.get('/email-availability', authController.checkEmail);
router.get('/landing-stats', authController.getLandingStats);

module.exports = router;
