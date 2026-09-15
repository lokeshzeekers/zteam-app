const router = require('express').Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/adminController');

router.use(requireAuth, requireAdmin);

router.post('/departments', ctrl.createDepartment);
router.get('/departments', ctrl.listDepartments);
router.put('/departments/:id', ctrl.updateDepartment);
router.delete('/departments/:id', ctrl.deleteDepartment);

router.post('/employees', ctrl.createEmployee);
router.get('/employees', ctrl.listEmployees);
router.put('/employees/:id', ctrl.updateEmployee);
router.post('/employees/:id/reset-password', ctrl.resetEmployeePassword);
router.delete('/employees/:id', ctrl.deleteEmployee);

module.exports = router;
