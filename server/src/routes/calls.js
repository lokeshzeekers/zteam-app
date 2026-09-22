const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/callHistoryController');

router.use(requireAuth);
router.get('/with/:userId', ctrl.getDMCallHistory);
router.get('/group/:id', ctrl.getGroupCallHistory);

module.exports = router;
