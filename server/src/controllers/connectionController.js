const { Op } = require('sequelize');
const { Connection, User } = require('../models');
const { publicUser } = require('./authController');

async function sendRequest(req, res) {
  const requesterId = req.user.id;
  const { receiverId } = req.body;
  if (!receiverId || Number(receiverId) === requesterId) {
    return res.status(400).json({ error: 'Invalid receiverId' });
  }
  const receiver = await User.findByPk(receiverId);
  if (!receiver) return res.status(404).json({ error: 'User not found' });
  if (receiver.departmentId === req.user.departmentId) {
    return res.status(400).json({ error: 'Already connected - same department' });
  }

  const existing = await Connection.findOne({
    where: {
      [Op.or]: [
        { requesterId, receiverId },
        { requesterId: receiverId, receiverId: requesterId },
      ],
    },
  });
  if (existing) {
    if (existing.status === 'rejected') {
      existing.status = 'pending';
      existing.requesterId = requesterId;
      existing.receiverId = receiverId;
      await existing.save();
      return res.json({ connection: existing });
    }
    return res.status(409).json({ error: 'Connection already exists', connection: existing });
  }

  const conn = await Connection.create({ requesterId, receiverId, status: 'pending' });

  const io = req.app.get('io');
  io.to(`user:${receiverId}`).emit('connection-request', { connection: conn, from: publicUser(req.user) });

  res.status(201).json({ connection: conn });
}

async function respondRequest(req, res) {
  const { id } = req.params;
  const { action } = req.body; // 'accept' | 'reject'
  const conn = await Connection.findByPk(id);
  if (!conn) return res.status(404).json({ error: 'Request not found' });
  if (conn.receiverId !== req.user.id) return res.status(403).json({ error: 'Not your request to respond to' });
  if (conn.status !== 'pending') return res.status(400).json({ error: 'Request already handled' });

  conn.status = action === 'accept' ? 'accepted' : 'rejected';
  await conn.save();

  const io = req.app.get('io');
  io.to(`user:${conn.requesterId}`).emit('connection-response', { connection: conn });
  io.to(`user:${conn.receiverId}`).emit('connection-response', { connection: conn });

  res.json({ connection: conn });
}

async function listMyConnections(req, res) {
  const userId = req.user.id;
  const conns = await Connection.findAll({
    where: { [Op.or]: [{ requesterId: userId }, { receiverId: userId }] },
    order: [['createdAt', 'DESC']],
  });

  const otherIds = conns.map(c => (c.requesterId === userId ? c.receiverId : c.requesterId));
  const users = await User.findAll({ where: { id: otherIds } });
  const userMap = Object.fromEntries(users.map(u => [u.id, publicUser(u)]));

  const enriched = conns.map(c => {
    const otherId = c.requesterId === userId ? c.receiverId : c.requesterId;
    return {
      id: c.id,
      status: c.status,
      direction: c.requesterId === userId ? 'sent' : 'received',
      user: userMap[otherId],
      createdAt: c.createdAt,
    };
  });

  res.json({ connections: enriched });
}

module.exports = { sendRequest, respondRequest, listMyConnections };
