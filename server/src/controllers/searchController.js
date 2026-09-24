const { Op } = require('sequelize');
const { Message, GroupMessage, GroupMember, Group, User, Department, ConversationClear, GroupHide } = require('../models');

// Search across every DM and group conversation the user can actually see —
// same visibility rules the normal chat views already enforce (soft-deleted
// messages excluded, and anything before a conversation/group was cleared
// or hidden by THIS user stays out of their results too).
async function searchMessages(req, res) {
  const me = req.user;
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.status(400).json({ error: 'Search term must be at least 2 characters' });

  const like = { [Op.like]: `%${q}%` };

  // DM side
  const dmMatches = await Message.findAll({
    where: {
      deletedAt: null,
      content: like,
      [Op.or]: [{ senderId: me.id }, { receiverId: me.id }],
    },
    order: [['createdAt', 'DESC']],
    limit: 50,
  });
  const clears = await ConversationClear.findAll({ where: { userId: me.id } });
  const clearedAtByOther = Object.fromEntries(clears.map((c) => [c.otherUserId, c.clearedAt]));
  const dmResults = dmMatches.filter((m) => {
    const otherId = m.senderId === me.id ? m.receiverId : m.senderId;
    const clearedAt = clearedAtByOther[otherId];
    return !clearedAt || new Date(m.createdAt) > new Date(clearedAt);
  });
  const dmOtherIds = [...new Set(dmResults.map((m) => (m.senderId === me.id ? m.receiverId : m.senderId)))];
  const dmUsers = await User.findAll({ where: { id: dmOtherIds } });
  const dmUserMap = Object.fromEntries(dmUsers.map((u) => [u.id, u]));

  // Group side
  const myMemberships = await GroupMember.findAll({ where: { userId: me.id } });
  const myGroupIds = myMemberships.map((m) => m.groupId);
  const groupMatches = myGroupIds.length ? await GroupMessage.findAll({
    where: { deletedAt: null, content: like, groupId: myGroupIds },
    order: [['createdAt', 'DESC']],
    limit: 50,
  }) : [];
  const hides = await GroupHide.findAll({ where: { userId: me.id, groupId: myGroupIds } });
  const hiddenAtByGroup = Object.fromEntries(hides.map((h) => [h.groupId, h.hiddenAt]));
  const groupResults = groupMatches.filter((m) => {
    const hiddenAt = hiddenAtByGroup[m.groupId];
    return !hiddenAt || new Date(m.createdAt) > new Date(hiddenAt);
  });
  const groupIds = [...new Set(groupResults.map((m) => m.groupId))];
  const groups = await Group.findAll({ where: { id: groupIds } });
  const groupMap = Object.fromEntries(groups.map((g) => [g.id, g]));

  res.json({
    directMessages: dmResults.map((m) => {
      const otherId = m.senderId === me.id ? m.receiverId : m.senderId;
      return {
        id: m.id, content: m.content, createdAt: m.createdAt,
        withUser: dmUserMap[otherId] ? { id: dmUserMap[otherId].id, name: dmUserMap[otherId].name } : null,
      };
    }).filter((r) => r.withUser),
    groupMessages: groupResults.map((m) => ({
      id: m.id, content: m.content, createdAt: m.createdAt, senderId: m.senderId,
      group: groupMap[m.groupId] ? { id: groupMap[m.groupId].id, name: groupMap[m.groupId].name } : null,
    })).filter((r) => r.group),
  });
}

// Directory search over existing name/email/department fields — same data
// already exposed by the admin employee list and directory pages, just
// filtered by a query string instead of listed in full.
async function searchDirectory(req, res) {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.status(400).json({ error: 'Search term must be at least 2 characters' });

  const like = { [Op.like]: `%${q}%` };
  const users = await User.findAll({
    where: {
      [Op.or]: [
        { name: like }, { email: like }, { position: like }, { '$department.name$': like },
      ],
    },
    include: [{ model: Department, as: 'department', attributes: ['id', 'name'] }],
    limit: 50,
  });

  res.json({
    results: users.map((u) => ({
      id: u.id, name: u.name, email: u.email, position: u.position,
      department: u.department ? { id: u.department.id, name: u.department.name } : null,
    })),
  });
}

module.exports = { searchMessages, searchDirectory };
