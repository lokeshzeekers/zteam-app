const { Op } = require('sequelize');
const { Connection } = require('../models');

/**
 * Returns true if userA and userB are allowed to message/call/share files.
 * Rule: same department => always allowed.
 * Different department => requires an ACCEPTED connection (either direction).
 */
async function canCommunicate(userA, userB) {
  if (!userA || !userB) return false;
  if (userA.id === userB.id) return false;
  if (userA.departmentId && userA.departmentId === userB.departmentId) return true;

  const conn = await Connection.findOne({
    where: {
      status: 'accepted',
      [Op.or]: [
        { requesterId: userA.id, receiverId: userB.id },
        { requesterId: userB.id, receiverId: userA.id },
      ],
    },
  });
  return !!conn;
}

module.exports = { canCommunicate };
