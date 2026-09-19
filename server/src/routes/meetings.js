const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/meetingController');

router.use(requireAuth);
router.post('/', ctrl.createMeeting);
router.get('/', ctrl.listMyMeetings);
router.put('/:id', ctrl.updateMeeting);
router.delete('/:id', ctrl.deleteMeeting);
router.post('/:id/start', ctrl.startMeeting);
router.post('/:id/end', ctrl.endMeeting);

module.exports = router;
