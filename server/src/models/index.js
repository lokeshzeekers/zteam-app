const sequelize = require('../config/db');
const Department = require('./Department');
const User = require('./User');
const Connection = require('./Connection');
const Message = require('./Message');
const CallLog = require('./CallLog');

Department.hasMany(User, { foreignKey: 'departmentId', as: 'members' });
User.belongsTo(Department, { foreignKey: 'departmentId', as: 'department' });

User.hasMany(Connection, { foreignKey: 'requesterId', as: 'sentConnections' });
User.hasMany(Connection, { foreignKey: 'receiverId', as: 'receivedConnections' });

module.exports = { sequelize, Department, User, Connection, Message, CallLog };
