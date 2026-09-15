const { Op } = require('sequelize');
const { User, Department, Connection } = require('../models');

// List all departments (for the "other departments" browse view)
async function listDepartments(req, res) {
  const depts = await Department.findAll({ order: [['name', 'ASC']] });
  res.json({ departments: depts });
}

// List members of a department.
// If viewer is in the SAME department -> full details.
// If viewer has an ACCEPTED connection with a member -> full details for that member.
// Otherwise -> only name + position + connection status (locked).
async function listDepartmentMembers(req, res) {
  const departmentId = req.params.id;
  const viewer = req.user;

  const members = await User.findAll({
    where: { departmentId },
    attributes: ['id', 'name', 'position', 'email', 'phone', 'employeeNumber', 'isActive', 'avatarUrl', 'departmentId'],
    order: [['name', 'ASC']],
  });

  const sameDept = viewer.departmentId && String(viewer.departmentId) === String(departmentId);

  // Pull any connections between viewer and these members in one query
  const memberIds = members.map(m => m.id);
  const connections = await Connection.findAll({
    where: {
      [Op.or]: [
        { requesterId: viewer.id, receiverId: memberIds },
        { requesterId: memberIds, receiverId: viewer.id },
      ],
    },
  });

  const connMap = {};
  connections.forEach(c => {
    const otherId = c.requesterId === viewer.id ? c.receiverId : c.requesterId;
    connMap[otherId] = { status: c.status, direction: c.requesterId === viewer.id ? 'sent' : 'received', connectionId: c.id };
  });

  const result = members.map(m => {
    if (m.id === viewer.id) {
      return { id: m.id, name: m.name, position: m.position, isSelf: true };
    }
    const conn = connMap[m.id];
    const unlocked = sameDept || (conn && conn.status === 'accepted');
    if (unlocked) {
      return {
        id: m.id, name: m.name, position: m.position, email: m.email,
        phone: m.phone, employeeNumber: m.employeeNumber, isActive: m.isActive,
        avatarUrl: m.avatarUrl, unlocked: true, connection: conn || null,
      };
    }
    return {
      id: m.id, name: m.name, position: m.position, unlocked: false,
      connection: conn || null,
    };
  });

  res.json({ members: result, sameDept });
}

module.exports = { listDepartments, listDepartmentMembers };
