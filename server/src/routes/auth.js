const router = require('express').Router();
const { login, me, changePassword, updateProfile } = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');

router.post('/login', login);
router.get('/me', requireAuth, me);
router.put('/profile', requireAuth, updateProfile);
router.post('/change-password', requireAuth, changePassword);

module.exports = router;
