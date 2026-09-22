const { Op } = require('sequelize');
const { Message, User, ConversationClear } = require('../models');
const { canCommunicate } = require('../utils/permissions');
const { isPresent } = require('../utils/presence');

async function getConversation(req, res) {
  const me = req.user;
  const otherId = Number(req.params.userId);
  const other = await User.findByPk(otherId);
  if (!other) return res.status(404).json({ error: 'User not found' });

  const allowed = await canCommunicate(me, other);
  if (!allowed) return res.status(403).json({ error: 'Not connected with this user yet' });

  // Same per-user clear as the inbox (see listInbox): messages from at/before my own
  // clear point are hidden from ME ONLY. Enforced here, server-side, so every entry
  // point that opens this conversation - Recent Chats, Department -> person, Inbox -
  // goes through this one query and can't be bypassed by calling the API directly.
  const clear = await ConversationClear.findOne({ where: { userId: me.id, otherUserId: otherId } });
  const where = {
    deletedAt: null,
    [Op.or]: [
      { senderId: me.id, receiverId: otherId },
      { senderId: otherId, receiverId: me.id },
    ],
  };
  if (clear) where.createdAt = { [Op.gt]: clear.clearedAt };

  const messages = await Message.findAll({ where, order: [['createdAt', 'ASC']], limit: 500 });

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
    where: { deletedAt: null, [Op.or]: [{ senderId: me.id }, { receiverId: me.id }] },
    order: [['createdAt', 'DESC']],
    limit: 500,
  });

  const clears = await ConversationClear.findAll({ where: { userId: me.id } });
  const clearedAtByOther = Object.fromEntries(clears.map((c) => [c.otherUserId, c.clearedAt]));

  const seen = new Set();
  const threads = [];
  for (const m of messages) {
    const otherId = m.senderId === me.id ? m.receiverId : m.senderId;
    if (seen.has(otherId)) continue;
    seen.add(otherId);
    // "Deleted" a conversation just hides it until something new happens —
    // if the most recent message is older than (or equal to) when this user
    // cleared it, the thread stays out of their inbox.
    const clearedAt = clearedAtByOther[otherId];
    if (clearedAt && new Date(m.createdAt) <= new Date(clearedAt)) continue;
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
        isActive: isPresent(userMap[t.otherUserId]),
        avatarUrl: userMap[t.otherUserId].avatarUrl,
      } : null,
      lastMessage: t.lastMessage,
    })),
  });
}

// Delete/hide this conversation from MY inbox only. Never touches the other
// participant's view or the shared message rows.
async function clearConversation(req, res) {
  const me = req.user;
  const otherId = Number(req.params.userId);
  const [row] = await ConversationClear.findOrCreate({
    where: { userId: me.id, otherUserId: otherId },
    defaults: { clearedAt: new Date() },
  });
  row.clearedAt = new Date();
  await row.save();
  // Tell every OTHER open session of mine (another tab/device) this thread is gone
  // from Recent Chats too - the same targeted-room pattern already used for
  // messages-deleted / user-removed, so no new sync mechanism is introduced.
  req.app.get('io')?.to(`user:${me.id}`).emit('conversation-cleared', { otherUserId: otherId });
  res.json({ success: true });
}

// Bulk-delete one or more of MY OWN messages in a DM conversation. Soft
// delete (deletedAt) so ids/ordering stay stable and both sides' clients
// can be told exactly which ones disappeared.
async function deleteMessages(req, res) {
  const me = req.user;
  const ids = (req.body.messageIds || []).map(Number).filter(Boolean);
  if (ids.length === 0) return res.status(400).json({ error: 'No messages specified' });

  const messages = await Message.findAll({ where: { id: ids } });
  const notOwned = messages.filter((m) => m.senderId !== me.id);
  if (notOwned.length > 0) {
    return res.status(403).json({ error: 'You can only delete your own messages' });
  }
  if (messages.length === 0) return res.json({ success: true, deletedIds: [] });

  const now = new Date();
  await Message.update({ deletedAt: now }, { where: { id: messages.map((m) => m.id) } });

  // Both participants could be spread across the same conversation; notify both.
  const otherIds = [...new Set(messages.map((m) => (m.senderId === me.id ? m.receiverId : m.senderId)))];
  const io = req.app.get('io');
  const deletedIds = messages.map((m) => m.id);
  io.to(`user:${me.id}`).emit('messages-deleted', { messageIds: deletedIds, otherUserId: otherIds[0] });
  otherIds.forEach((id) => io.to(`user:${id}`).emit('messages-deleted', { messageIds: deletedIds, otherUserId: me.id }));

  res.json({ success: true, deletedIds });
}

module.exports = { getConversation, listInbox, clearConversation, deleteMessages };
