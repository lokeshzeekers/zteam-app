const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/db');

class User extends Model {}
User.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING, allowNull: false },
  email: { type: DataTypes.STRING, allowNull: false, unique: true },
  password: { type: DataTypes.STRING, allowNull: false }, // hashed
  phone: { type: DataTypes.STRING, allowNull: true },
  employeeNumber: { type: DataTypes.STRING, allowNull: true },
  position: { type: DataTypes.STRING, allowNull: true },
  role: { type: DataTypes.ENUM('admin', 'employee'), defaultValue: 'employee' },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: false }, // "Active" button status
  lastActiveAt: { type: DataTypes.DATE, allowNull: true },
  avatarUrl: { type: DataTypes.STRING, allowNull: true },
}, { sequelize, modelName: 'user', tableName: 'users' });

module.exports = User;
