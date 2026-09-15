const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/directoryController');

router.use(requireAuth);
router.get('/departments', ctrl.listDepartments);
router.get('/departments/:id/members', ctrl.listDepartmentMembers);

module.exports = router;
