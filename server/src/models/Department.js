const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/db');

class Department extends Model {}
Department.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING, allowNull: false, unique: true },
  description: { type: DataTypes.STRING, allowNull: true },
}, { sequelize, modelName: 'department', tableName: 'departments' });

module.exports = Department;
