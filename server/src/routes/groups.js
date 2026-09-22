const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/groupController');

router.use(requireAuth);
router.post('/', ctrl.createGroup);
router.get('/', ctrl.listMyGroups);
router.get('/:id', ctrl.getGroup);
router.put('/:id', ctrl.updateGroup);
router.delete('/:id', ctrl.deleteGroup);
router.get('/:id/messages', ctrl.getGroupMessages);
router.post('/:id/messages/delete', ctrl.deleteGroupMessages);
router.post('/:id/hide', ctrl.hideGroup);

module.exports = router;
