const sequelize = require('../config/db');
const Department = require('./Department');
const User = require('./User');
const Connection = require('./Connection');
const Message = require('./Message');
const CallLog = require('./CallLog');
const Group = require('./Group');
const GroupMember = require('./GroupMember');
const GroupMessage = require('./GroupMessage');
const Meeting = require('./Meeting');
const MeetingParticipant = require('./MeetingParticipant');
const ConversationClear = require('./ConversationClear');
const GroupHide = require('./GroupHide');

Department.hasMany(User, { foreignKey: 'departmentId', as: 'members' });
User.belongsTo(Department, { foreignKey: 'departmentId', as: 'department' });

User.hasMany(Connection, { foreignKey: 'requesterId', as: 'sentConnections' });
User.hasMany(Connection, { foreignKey: 'receiverId', as: 'receivedConnections' });

Group.hasMany(GroupMember, { foreignKey: 'groupId', as: 'members' });
GroupMember.belongsTo(Group, { foreignKey: 'groupId' });
Group.hasMany(GroupMessage, { foreignKey: 'groupId', as: 'messages' });

Meeting.hasMany(MeetingParticipant, { foreignKey: 'meetingId', as: 'participants' });
MeetingParticipant.belongsTo(Meeting, { foreignKey: 'meetingId' });

module.exports = {
  sequelize, Department, User, Connection, Message, CallLog,
  Group, GroupMember, GroupMessage, Meeting, MeetingParticipant,
  ConversationClear, GroupHide,
};
