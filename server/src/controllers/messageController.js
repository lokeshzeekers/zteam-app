const { Op } = require('sequelize');
const { Message, User } = require('../models');
const { canCommunicate } = require('../utils/permissions');

async function getConversation(req, res) {
  const me = req.user;
  const otherId = Number(req.params.userId);
  const other = await User.findByPk(otherId);
  if (!other) return res.status(404).json({ error: 'User not found' });

  const allowed = await canCommunicate(me, other);
  if (!allowed) return res.status(403).json({ error: 'Not connected with this user yet' });

  const messages = await Message.findAll({
    where: {
      [Op.or]: [
        { senderId: me.id, receiverId: otherId },
        { senderId: otherId, receiverId: me.id },
      ],
    },
    order: [['createdAt', 'ASC']],
    limit: 500,
  });

  // mark incoming as read
  await Message.update(
    { readAt: new Date() },
    { where: { senderId: otherId, receiverId: me.id, readAt: null } }
  );

  res.json({ messages });
}

// list recent conversations (inbox) - most recent message per counterpart
async function listInbox(req, res) {
  const me = req.user;
  const messages = await Message.findAll({
    where: { [Op.or]: [{ senderId: me.id }, { receiverId: me.id }] },
    order: [['createdAt', 'DESC']],
    limit: 500,
  });

  const seen = new Set();
  const threads = [];
  for (const m of messages) {
    const otherId = m.senderId === me.id ? m.receiverId : m.senderId;
    if (seen.has(otherId)) continue;
    seen.add(otherId);
    threads.push({ otherUserId: otherId, lastMessage: m });
  }

  const users = await User.findAll({ where: { id: Array.from(seen) } });
  const userMap = Object.fromEntries(users.map(u => [u.id, u]));

  res.json({
    threads: threads.map(t => ({
      user: userMap[t.otherUserId] ? {
        id: userMap[t.otherUserId].id,
        name: userMap[t.otherUserId].name,
        position: userMap[t.otherUserId].position,
        isActive: userMap[t.otherUserId].isActive,
        avatarUrl: userMap[t.otherUserId].avatarUrl,
      } : null,
      lastMessage: t.lastMessage,
    })),
  });
}

module.exports = { getConversation, listInbox };
