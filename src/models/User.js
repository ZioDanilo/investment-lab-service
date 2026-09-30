const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const User = sequelize.define('User', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
  username: { type: DataTypes.STRING(100), allowNull: false, unique: true }
}, {
  tableName: 'users',
  timestamps: true,
  underscored: true
});

module.exports = User;
