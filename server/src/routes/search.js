const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/searchController');

router.use(requireAuth);
router.get('/messages', ctrl.searchMessages);
router.get('/directory', ctrl.searchDirectory);

module.exports = router;
