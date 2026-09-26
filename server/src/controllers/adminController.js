const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const {
  User, Department, Message, Connection, Group, GroupMember, GroupMessage, Meeting, MeetingParticipant,
} = require('../models');
const sequelize = require('../config/db');
const generatePassword = require('../utils/generatePassword');

// Same email with different case/spacing ("Bob@x.com" vs " bob@x.com ") is still a
// duplicate. Store emails normalized and look them up the same way.
function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}
function findByEmail(email) {
  return User.findOne({ where: sequelize.where(sequelize.fn('LOWER', sequelize.col('email')), normalizeEmail(email)) });
}
const { publicUser } = require('./authController');
const { isPresent, forgetUser } = require('../utils/presence');
const { clearMeetingRoom } = require('../sockets');

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
  const { name, phone, employeeNumber, position, departmentId, role } = req.body;
  const email = normalizeEmail(req.body.email);
  if (!name || !email || !departmentId) {
    return res.status(400).json({ error: 'name, email and departmentId are required' });
  }
  const existing = await findByEmail(email);
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
  res.json({ employees: users.map((u) => ({ ...publicUser(u), isActive: isPresent(u) })) });
}

async function updateEmployee(req, res) {
  const user = await User.findByPk(req.params.id);
  if (!user) return res.status(404).json({ error: 'Employee not found' });
  const { name, phone, employeeNumber, position, departmentId, role, newPassword } = req.body;
  const email = req.body.email !== undefined ? normalizeEmail(req.body.email) : undefined;

  if (email && email !== user.email) {
    const existing = await findByEmail(email);
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

// Deleting an employee removes them everywhere: their chats, connections,
// group memberships and meetings go too, every open session of theirs is
// signed out, and everybody else's screen drops them immediately (recent
// chats, member lists, green "active" dot) instead of only after a refresh.
async function deleteEmployee(req, res) {
  const user = await User.findByPk(req.params.id);
  if (!user) return res.status(404).json({ error: 'Employee not found' });
  if (user.id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account' });

  const id = user.id;
  const io = req.app.get('io');

  // Groups they owned: hand over to the longest-standing remaining member, or
  // remove the group if nobody else is in it.
  const owned = await Group.findAll({ where: { createdBy: id } });
  for (const g of owned) {
    const next = await GroupMember.findOne({
      where: { groupId: g.id, userId: { [Op.ne]: id } },
      order: [['id', 'ASC']],
    });
    if (next) {
      g.createdBy = next.userId;
      await g.save();
      next.role = 'owner';
      await next.save();
    } else {
      await GroupMessage.destroy({ where: { groupId: g.id } });
      await GroupMember.destroy({ where: { groupId: g.id } });
      await g.destroy();
    }
  }
  await GroupMember.destroy({ where: { userId: id } });

  // Meetings they organised are cancelled for the people invited.
  const organised = await Meeting.findAll({ where: { createdBy: id } });
  for (const m of organised) {
    const invited = await MeetingParticipant.findAll({ where: { meetingId: m.id } });
    invited.filter((x) => x.userId !== id).forEach((x) => io.to(`user:${x.userId}`).emit('meeting-cancelled', { meetingId: m.id, title: m.title }));
    io.to(`meeting:${m.id}`).emit('meeting-ended', { meetingId: m.id, title: m.title, cancelled: true });
    io.in(`meeting:${m.id}`).socketsLeave(`meeting:${m.id}`);
    clearMeetingRoom(m.id);
    await MeetingParticipant.destroy({ where: { meetingId: m.id } });
    await m.destroy();
  }
  await MeetingParticipant.destroy({ where: { userId: id } });

  await Message.destroy({ where: { [Op.or]: [{ senderId: id }, { receiverId: id }] } });
  await Connection.destroy({ where: { [Op.or]: [{ requesterId: id }, { receiverId: id }] } });
  await user.destroy();

  // Live clean-up: tell every client (including the deleted user's own open
  // sessions, which sign themselves out), then cut those sessions off.
  io.emit('presence-update', { userId: id, isActive: false });
  io.emit('user-removed', { userId: id });
  io.in(`user:${id}`).disconnectSockets(true);
  forgetUser(id);

  res.json({ success: true });
}

module.exports = {
  createDepartment, listDepartments, updateDepartment, deleteDepartment,
  createEmployee, listEmployees, updateEmployee, resetEmployeePassword, deleteEmployee,
};
