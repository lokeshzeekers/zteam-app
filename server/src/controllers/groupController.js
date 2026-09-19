const { Group, GroupMember, GroupMessage, User } = require('../models');
const { canCommunicate } = require('../utils/permissions');

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

  const result = [];
  for (const g of groups) {
    const members = await GroupMember.findAll({ where: { groupId: g.id } });
    const users = await User.findAll({ where: { id: members.map((m) => m.userId) } });
    result.push({
      id: g.id, name: g.name, description: g.description, createdBy: g.createdBy,
      members: users.map((u) => ({ id: u.id, name: u.name, position: u.position })),
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
      members: users.map((u) => ({ id: u.id, name: u.name, position: u.position, isActive: u.isActive })),
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
  await group.destroy();
  res.json({ success: true });
}

async function getGroupMessages(req, res) {
  const groupId = req.params.id;
  if (!(await isMember(groupId, req.user.id))) return res.status(403).json({ error: 'Not a member of this group' });
  const messages = await GroupMessage.findAll({ where: { groupId }, order: [['createdAt', 'ASC']], limit: 500 });
  res.json({ messages });
}

module.exports = { createGroup, listMyGroups, getGroup, updateGroup, deleteGroup, getGroupMessages, isMember };
