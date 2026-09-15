require('dotenv').config();
const bcrypt = require('bcryptjs');
const { sequelize, User, Department } = require('../models');

async function seed() {
  await sequelize.sync();

  const email = process.env.ADMIN_EMAIL || 'admin@zteam.local';
  const existing = await User.findOne({ where: { email } });
  if (existing) {
    console.log(`Admin already exists: ${email}`);
    process.exit(0);
  }

  let dept = await Department.findOne({ where: { name: 'Management' } });
  if (!dept) dept = await Department.create({ name: 'Management', description: 'Administration' });

  const password = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
  const hashed = await bcrypt.hash(password, 10);

  await User.create({
    name: process.env.ADMIN_NAME || 'Super Admin',
    email, password: hashed, role: 'admin',
    departmentId: dept.id, position: 'Administrator',
  });

  console.log('---------------------------------------------');
  console.log('Admin account created:');
  console.log('Email:', email);
  console.log('Password:', password);
  console.log('(Change this password after first login!)');
  console.log('---------------------------------------------');
  process.exit(0);
}

seed().catch(err => { console.error(err); process.exit(1); });
