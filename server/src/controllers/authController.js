const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User, Department } = require('../models');

function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    employeeNumber: user.employeeNumber,
    position: user.position,
    role: user.role,
    departmentId: user.departmentId,
    isActive: user.isActive,
    avatarUrl: user.avatarUrl,
  };
}

async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const user = await User.findOne({ where: { email }, include: [{ model: Department, as: 'department' }] });
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

  const token = signToken(user);
  res.json({ token, user: publicUser(user) });
}

async function me(req, res) {
  res.json({ user: publicUser(req.user) });
}

async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }
  const user = req.user;
  const ok = await bcrypt.compare(currentPassword || '', user.password);
  if (!ok) return res.status(400).json({ error: 'Current password is incorrect' });

  user.password = await bcrypt.hash(newPassword, 10);
  await user.save();
  res.json({ success: true });
}

// Self-service: an employee/admin editing their OWN name, phone, or email.
// Password changes go through changePassword (requires current password).
async function updateProfile(req, res) {
  const user = req.user;
  const { name, phone, email } = req.body;

  if (email && email !== user.email) {
    const existing = await User.findOne({ where: { email } });
    if (existing && existing.id !== user.id) {
      return res.status(409).json({ error: 'Email already in use' });
    }
    user.email = email;
  }
  if (name) user.name = name;
  if (phone !== undefined) user.phone = phone;

  await user.save();
  res.json({ user: publicUser(user) });
}

module.exports = { login, me, changePassword, updateProfile, publicUser, signToken };
