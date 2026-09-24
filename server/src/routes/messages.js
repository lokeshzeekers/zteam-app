const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/messageController');

router.use(requireAuth);
router.get('/inbox', ctrl.listInbox);
router.get('/with/:userId', ctrl.getConversation);
router.delete('/with/:userId', ctrl.clearConversation);
router.post('/delete', ctrl.deleteMessages);
router.put('/:id', ctrl.editMessage);

module.exports = router;
