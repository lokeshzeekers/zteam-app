const bcrypt = require('bcryptjs');
const { User, Department } = require('../models');
const generatePassword = require('../utils/generatePassword');
const { publicUser } = require('./authController');

// ---- Departments ----
async function createDepartment(req, res) {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Department name is required' });
  const dept = await Department.create({ name, description });
  res.status(201).json({ department: dept });
}

async function listDepartments(req, res) {
  const depts = await Department.findAll({ order: [['name', 'ASC']] });
  res.json({ departments: depts });
}

async function updateDepartment(req, res) {
  const dept = await Department.findByPk(req.params.id);
  if (!dept) return res.status(404).json({ error: 'Department not found' });
  const { name, description } = req.body;
  if (name) dept.name = name;
  if (description !== undefined) dept.description = description;
  await dept.save();
  res.json({ department: dept });
}

async function deleteDepartment(req, res) {
  const dept = await Department.findByPk(req.params.id);
  if (!dept) return res.status(404).json({ error: 'Department not found' });
  await dept.destroy();
  res.json({ success: true });
}

// ---- Employees ----
async function createEmployee(req, res) {
  const { name, email, phone, employeeNumber, position, departmentId, role } = req.body;
  if (!name || !email || !departmentId) {
    return res.status(400).json({ error: 'name, email and departmentId are required' });
  }
  const existing = await User.findOne({ where: { email } });
  if (existing) return res.status(409).json({ error: 'Email already in use' });

  const tempPassword = generatePassword(10);
  const hashed = await bcrypt.hash(tempPassword, 10);

  const user = await User.create({
    name, email, phone, employeeNumber, position,
    departmentId, role: role === 'admin' ? 'admin' : 'employee',
    password: hashed,
  });

  // Temp password is returned ONCE so admin can share it with the employee.
  res.status(201).json({ user: publicUser(user), tempPassword });
}

async function listEmployees(req, res) {
  const { departmentId } = req.query;
  const where = departmentId ? { departmentId } : {};
  const users = await User.findAll({
    where,
    include: [{ model: Department, as: 'department' }],
    order: [['name', 'ASC']],
  });
  res.json({ employees: users.map(publicUser) });
}

async function updateEmployee(req, res) {
  const user = await User.findByPk(req.params.id);
  if (!user) return res.status(404).json({ error: 'Employee not found' });
  const { name, email, phone, employeeNumber, position, departmentId, role, newPassword } = req.body;

  if (email && email !== user.email) {
    const existing = await User.findOne({ where: { email } });
    if (existing && existing.id !== user.id) {
      return res.status(409).json({ error: 'Email already in use by another account' });
    }
    user.email = email;
  }
  if (name) user.name = name;
  if (phone !== undefined) user.phone = phone;
  if (employeeNumber !== undefined) user.employeeNumber = employeeNumber;
  if (position !== undefined) user.position = position;
  if (departmentId) user.departmentId = departmentId;
  if (role) user.role = role;
  if (newPassword) {
    if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    user.password = await bcrypt.hash(newPassword, 10);
  }

  await user.save();
  res.json({ user: publicUser(user) });
}

async function resetEmployeePassword(req, res) {
  const user = await User.findByPk(req.params.id);
  if (!user) return res.status(404).json({ error: 'Employee not found' });
  const tempPassword = generatePassword(10);
  user.password = await bcrypt.hash(tempPassword, 10);
  await user.save();
  res.json({ success: true, tempPassword });
}

async function deleteEmployee(req, res) {
  const user = await User.findByPk(req.params.id);
  if (!user) return res.status(404).json({ error: 'Employee not found' });
  await user.destroy();
  res.json({ success: true });
}

module.exports = {
  createDepartment, listDepartments, updateDepartment, deleteDepartment,
  createEmployee, listEmployees, updateEmployee, resetEmployeePassword, deleteEmployee,
};
