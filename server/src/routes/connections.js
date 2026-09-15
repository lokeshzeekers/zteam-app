const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/connectionController');

router.use(requireAuth);
router.get('/', ctrl.listMyConnections);
router.post('/request', ctrl.sendRequest);
router.post('/:id/respond', ctrl.respondRequest);

module.exports = router;
