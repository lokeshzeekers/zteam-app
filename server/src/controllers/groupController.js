const { Op } = require('sequelize');
const { Group, GroupMember, GroupMessage, User, GroupHide, GroupRead } = require('../models');
const { canCommunicate } = require('../utils/permissions');
const { isPresent } = require('../utils/presence');

const PAGE_SIZE = 50;

async function isMember(groupId, userId) {
  const row = await GroupMember.findOne({ where: { groupId, userId } });
  return !!row;
}

// Create a group. Every invited member must be someone the creator is
// already allowed to talk to (same department or an accepted connection) —
// you can't add a random locked contact into a group chat.
async function createGroup(req, res) {
  const { name, description, memberIds = [] } = req.body;
  if (!name) return res.status(400).json({ error: 'Group name is required' });

  const uniqueIds = [...new Set(memberIds.map(Number).filter((id) => id !== req.user.id))];
  const members = await User.findAll({ where: { id: uniqueIds } });
  for (const m of members) {
    const allowed = await canCommunicate(req.user, m);
    if (!allowed) return res.status(403).json({ error: `You are not connected with ${m.name}` });
  }

  const group = await Group.create({ name, description, createdBy: req.user.id });
  await GroupMember.create({ groupId: group.id, userId: req.user.id, role: 'owner' });
  for (const m of members) {
    await GroupMember.create({ groupId: group.id, userId: m.id, role: 'member' });
  }

  const io = req.app.get('io');
  members.forEach((m) => io.to(`user:${m.id}`).emit('group-invite', { group: { id: group.id, name: group.name } }));

  res.status(201).json({ group });
}

async function listMyGroups(req, res) {
  const memberships = await GroupMember.findAll({ where: { userId: req.user.id } });
  const groupIds = memberships.map((m) => m.groupId);
  const groups = await Group.findAll({ where: { id: groupIds }, order: [['name', 'ASC']] });

  const hides = await GroupHide.findAll({ where: { userId: req.user.id, groupId: groupIds } });
  const hiddenAtByGroup = Object.fromEntries(hides.map((h) => [h.groupId, h.hiddenAt]));
  const reads = await GroupRead.findAll({ where: { userId: req.user.id, groupId: groupIds } });
  const lastReadByGroup = Object.fromEntries(reads.map((r) => [r.groupId, r.lastReadAt]));

  const result = [];
  for (const g of groups) {
    const hiddenAt = hiddenAtByGroup[g.id];
    const latestMessage = await GroupMessage.findOne({
      where: { groupId: g.id, deletedAt: null },
      order: [['createdAt', 'DESC']],
    });
    if (hiddenAt) {
      // Hidden unless there's been a new message since the user hid it —
      // same "comes back on new activity" rule as a cleared DM conversation.
      if (!latestMessage || new Date(latestMessage.createdAt) <= new Date(hiddenAt)) continue;
    }
    const members = await GroupMember.findAll({ where: { groupId: g.id } });
    const users = await User.findAll({ where: { id: members.map((m) => m.userId) } });
    const lastReadAt = lastReadByGroup[g.id];
    const unread = !!latestMessage && (!lastReadAt || new Date(latestMessage.createdAt) > new Date(lastReadAt));
    result.push({
      id: g.id, name: g.name, description: g.description, createdBy: g.createdBy,
      members: users.map((u) => ({ id: u.id, name: u.name, position: u.position })),
      unread,
    });
  }
  res.json({ groups: result });
}

async function getGroup(req, res) {
  const group = await Group.findByPk(req.params.id);
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (!(await isMember(group.id, req.user.id))) return res.status(403).json({ error: 'Not a member of this group' });

  const members = await GroupMember.findAll({ where: { groupId: group.id } });
  const users = await User.findAll({ where: { id: members.map((m) => m.userId) } });
  res.json({
    group: {
      id: group.id, name: group.name, description: group.description, createdBy: group.createdBy,
      members: users.map((u) => ({ id: u.id, name: u.name, position: u.position, isActive: isPresent(u) })),
    },
  });
}

async function updateGroup(req, res) {
  const group = await Group.findByPk(req.params.id);
  if (!group) return res.status(404).json({ error: 'Group not found' });
  const membership = await GroupMember.findOne({ where: { groupId: group.id, userId: req.user.id } });
  if (!membership || (membership.role !== 'owner' && req.user.role !== 'admin')) {
    return res.status(403).json({ error: 'Only the group owner can edit this group' });
  }
  const { name, description, addMemberIds = [], removeMemberIds = [] } = req.body;
  if (name) group.name = name;
  if (description !== undefined) group.description = description;
  await group.save();

  for (const id of addMemberIds.map(Number)) {
    const target = await User.findByPk(id);
    if (!target) continue;
    const allowed = await canCommunicate(req.user, target);
    if (!allowed) continue;
    const exists = await GroupMember.findOne({ where: { groupId: group.id, userId: id } });
    if (!exists) await GroupMember.create({ groupId: group.id, userId: id, role: 'member' });
  }
  for (const id of removeMemberIds.map(Number)) {
    if (id === group.createdBy) continue; // the owner can't be removed from their own group
    await GroupMember.destroy({ where: { groupId: group.id, userId: id } });
  }

  res.json({ success: true });
}

async function deleteGroup(req, res) {
  const group = await Group.findByPk(req.params.id);
  if (!group) return res.status(404).json({ error: 'Group not found' });
  const membership = await GroupMember.findOne({ where: { groupId: group.id, userId: req.user.id } });
  if (!membership || (membership.role !== 'owner' && req.user.role !== 'admin')) {
    return res.status(403).json({ error: 'Only the group owner can delete this group' });
  }
  await GroupMessage.destroy({ where: { groupId: group.id } });
  await GroupMember.destroy({ where: { groupId: group.id } });
  await GroupRead.destroy({ where: { groupId: group.id } });
  await GroupHide.destroy({ where: { groupId: group.id } });
  await group.destroy();
  res.json({ success: true });
}

// Paginated the same way as DM history (see messageController.getConversation):
// newest page by default, `before` (a message id) to page further back.
async function getGroupMessages(req, res) {
  const groupId = req.params.id;
  if (!(await isMember(groupId, req.user.id))) return res.status(403).json({ error: 'Not a member of this group' });

  const where = { groupId, deletedAt: null };
  const before = req.query.before ? Number(req.query.before) : null;
  if (before) {
    const anchor = await GroupMessage.findByPk(before);
    if (anchor) where.id = { [Op.lt]: before };
  }
  const limit = Math.min(Number(req.query.limit) || PAGE_SIZE, 200);

  const page = await GroupMessage.findAll({ where, order: [['id', 'DESC']], limit: limit + 1 });
  const hasMore = page.length > limit;
  const messages = page.slice(0, limit).reverse();

  // Opening the group (the first, non-paginated page) marks it read.
  if (!before) {
    await markRead(req.user.id, Number(groupId));
  }

  res.json({ messages, hasMore });
}

// Shared by getGroupMessages and markGroupRead — findOrCreate+save rather than
// .upsert(), matching the same safe pattern GroupHide/ConversationClear already
// use (there's no unique index on (userId, groupId) for a real upsert to match
// against, so .upsert() would just keep inserting new rows instead of updating).
async function markRead(userId, groupId) {
  const [row] = await GroupRead.findOrCreate({
    where: { userId, groupId },
    defaults: { lastReadAt: new Date() },
  });
  row.lastReadAt = new Date();
  await row.save();
}

// Explicit "mark read" for when the client wants to clear the unread badge
// without necessarily having just fetched the first page (e.g. it already
// has the messages cached from a socket push).
async function markGroupRead(req, res) {
  const groupId = req.params.id;
  if (!(await isMember(groupId, req.user.id))) return res.status(403).json({ error: 'Not a member of this group' });
  await markRead(req.user.id, Number(groupId));
  res.json({ success: true });
}

// Hide this group from MY Groups list only — does not touch membership,
// other members, or the group's shared history in any way.
async function hideGroup(req, res) {
  const groupId = req.params.id;
  if (!(await isMember(groupId, req.user.id))) return res.status(403).json({ error: 'Not a member of this group' });
  const [row] = await GroupHide.findOrCreate({
    where: { userId: req.user.id, groupId },
    defaults: { hiddenAt: new Date() },
  });
  row.hiddenAt = new Date();
  await row.save();
  res.json({ success: true });
}

// Bulk-delete one or more of MY OWN messages in a group. Any current member
// can delete their own messages; nobody can delete someone else's — there is
// no existing group-admin/moderator permission over other members' messages
// to extend here, so this intentionally stays sender-only for everyone,
// owners included.
async function deleteGroupMessages(req, res) {
  const groupId = req.params.id;
  if (!(await isMember(groupId, req.user.id))) return res.status(403).json({ error: 'Not a member of this group' });

  const ids = (req.body.messageIds || []).map(Number).filter(Boolean);
  if (ids.length === 0) return res.status(400).json({ error: 'No messages specified' });

  const messages = await GroupMessage.findAll({ where: { id: ids, groupId } });
  const notOwned = messages.filter((m) => m.senderId !== req.user.id);
  if (notOwned.length > 0) {
    return res.status(403).json({ error: 'You can only delete your own messages' });
  }
  if (messages.length === 0) return res.json({ success: true, deletedIds: [] });

  const deletedIds = messages.map((m) => m.id);
  await GroupMessage.update({ deletedAt: new Date() }, { where: { id: deletedIds } });

  req.app.get('io').to(`group:${groupId}`).emit('group-messages-deleted', { groupId: Number(groupId), messageIds: deletedIds });

  res.json({ success: true, deletedIds });
}

// Edit one of MY OWN, not-deleted group messages. Same sender-only rule as
// deletion — no group-admin override exists to extend here either.
async function editGroupMessage(req, res) {
  const groupId = req.params.id;
  if (!(await isMember(groupId, req.user.id))) return res.status(403).json({ error: 'Not a member of this group' });

  const content = (req.body.content || '').trim();
  if (!content) return res.status(400).json({ error: 'Message content cannot be empty' });

  const message = await GroupMessage.findOne({ where: { id: req.params.messageId, groupId } });
  if (!message || message.deletedAt) return res.status(404).json({ error: 'Message not found' });
  if (message.senderId !== req.user.id) return res.status(403).json({ error: 'You can only edit your own messages' });
  if (message.type !== 'text') return res.status(400).json({ error: 'Only text messages can be edited' });

  message.content = content;
  message.editedAt = new Date();
  await message.save();

  const members = await GroupMember.findAll({ where: { groupId }, attributes: ['userId'] });
  if (members.length) req.app.get('io').to(members.map((m) => `user:${m.userId}`)).emit('group-message-edited', { groupId: Number(groupId), message });

  res.json({ message });
}

module.exports = {
  createGroup, listMyGroups, getGroup, updateGroup, deleteGroup, getGroupMessages, isMember,
  hideGroup, deleteGroupMessages, markGroupRead, editGroupMessage,
};
