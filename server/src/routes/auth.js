const router = require('express').Router();
const { login, me, changePassword, updateProfile } = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rateLimit');

router.post('/login', loginLimiter, login);
router.get('/me', requireAuth, me);
router.put('/profile', requireAuth, updateProfile);
router.post('/change-password', requireAuth, changePassword);

module.exports = router;
