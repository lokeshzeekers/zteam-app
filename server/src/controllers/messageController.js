const { Op } = require('sequelize');
const { Message, User, ConversationClear } = require('../models');
const { canCommunicate } = require('../utils/permissions');
const { isPresent } = require('../utils/presence');

const PAGE_SIZE = 50;

// A deleted message is never sent to a client with its content — only a
// "this message was deleted" placeholder (id, sender, time, deletedAt) so both
// people see the same thing in the chat and in the inbox preview.
function toClient(m) {
  const j = typeof m.toJSON === 'function' ? m.toJSON() : m;
  if (!j.deletedAt) return j;
  return { ...j, content: null, fileUrl: null, fileName: null };
}

// Paginated: most recent page by default, or the page just older than
// `before` (a message id) when the client asks to load more history.
// Returns ascending order (oldest-first, ready to append to the top of the
// list) plus hasMore so the client knows whether to show "load older".
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
  // Deleted messages are included (redacted) so they show as "This message was deleted".
  const where = {
    [Op.or]: [
      { senderId: me.id, receiverId: otherId },
      { senderId: otherId, receiverId: me.id },
    ],
  };
  if (clear) where.createdAt = { [Op.gt]: clear.clearedAt };

  const before = req.query.before ? Number(req.query.before) : null;
  if (before) {
    const anchor = await Message.findByPk(before);
    if (anchor) where.id = { ...(where.id || {}), [Op.lt]: before };
  }
  const limit = Math.min(Number(req.query.limit) || PAGE_SIZE, 200);

  const page = await Message.findAll({ where, order: [['id', 'DESC']], limit: limit + 1 });
  const hasMore = page.length > limit;
  const messages = page.slice(0, limit).reverse(); // oldest-first for rendering

  // Only the newest page (no "before" cursor) represents "I just opened this
  // chat" — mark incoming messages read/delivered from there, not while
  // scrolling up through old history.
  if (!before) {
    const now = new Date();
    await Message.update(
      { readAt: now, deliveredAt: now },
      { where: { senderId: otherId, receiverId: me.id, readAt: null } }
    );
    const justRead = await Message.findAll({
      where: { senderId: otherId, receiverId: me.id, readAt: now },
      attributes: ['id'],
    });
    if (justRead.length) {
      req.app.get('io')?.to(`user:${otherId}`).emit('messages-read', { messageIds: justRead.map((m) => m.id), by: me.id });
    }
  }

  res.json({ messages: messages.map(toClient), hasMore });
}

// Explicit "I'm looking at this chat right now" — marks everything the other
// person sent me as read and tells THEM immediately, so their ticks update live
// while I'm already inside the conversation (getConversation only does this
// once, when the chat is first opened).
async function markConversationRead(req, res) {
  const me = req.user;
  const otherId = Number(req.params.userId);
  const unread = await Message.findAll({
    where: { senderId: otherId, receiverId: me.id, readAt: null, deletedAt: null },
    attributes: ['id'],
  });
  if (unread.length) {
    const now = new Date();
    const ids = unread.map((m) => m.id);
    await Message.update({ readAt: now, deliveredAt: now }, { where: { id: ids, readAt: null } });
    req.app.get('io')?.to(`user:${otherId}`).emit('messages-read', { messageIds: ids, by: me.id });
  }
  res.json({ success: true });
}

// list recent conversations (inbox) - most recent message per counterpart
async function listInbox(req, res) {
  const me = req.user;
  // Deleted messages stay in the list (redacted) so the preview reads "This message was deleted".
  const messages = await Message.findAll({
    where: { [Op.or]: [{ senderId: me.id }, { receiverId: me.id }] },
    order: [['createdAt', 'DESC']],
    limit: 1000,
  });

  const clears = await ConversationClear.findAll({ where: { userId: me.id } });
  const clearedAtByOther = Object.fromEntries(clears.map((c) => [c.otherUserId, c.clearedAt]));

  // Unread = incoming, not read, NOT deleted, and after my own clear point. A message
  // that was deleted (by its sender) never counts as "new", even if I never opened it.
  const incoming = await Message.findAll({
    where: { receiverId: me.id, readAt: null, deletedAt: null },
    attributes: ['senderId', 'createdAt'],
  });
  const unreadBySender = {};
  for (const m of incoming) {
    const c = clearedAtByOther[m.senderId];
    if (c && new Date(m.createdAt) <= new Date(c)) continue;
    unreadBySender[m.senderId] = (unreadBySender[m.senderId] || 0) + 1;
  }

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
      lastMessage: toClient(t.lastMessage),
      unread: (unreadBySender[t.otherUserId] || 0) > 0,
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

// Edit one of MY OWN, not-deleted DM messages. File messages aren't
// editable (nothing text-based to edit); only plain text content.
async function editMessage(req, res) {
  const me = req.user;
  const id = Number(req.params.id);
  const content = (req.body.content || '').trim();
  if (!content) return res.status(400).json({ error: 'Message content cannot be empty' });

  const message = await Message.findByPk(id);
  if (!message || message.deletedAt) return res.status(404).json({ error: 'Message not found' });
  if (message.senderId !== me.id) return res.status(403).json({ error: 'You can only edit your own messages' });
  if (message.type !== 'text') return res.status(400).json({ error: 'Only text messages can be edited' });

  message.content = content;
  message.editedAt = new Date();
  await message.save();

  const otherId = message.senderId === me.id ? message.receiverId : message.senderId;
  const io = req.app.get('io');
  io.to(`user:${me.id}`).emit('message-edited', { message });
  io.to(`user:${otherId}`).emit('message-edited', { message });

  res.json({ message });
}

module.exports = { getConversation, listInbox, clearConversation, deleteMessages, editMessage, markConversationRead };
