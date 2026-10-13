const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const User = sequelize.define('User', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
  username: { type: DataTypes.STRING(100), allowNull: false, unique: true },
  password: { type: DataTypes.STRING(255), allowNull: true },
  role: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'GUEST' }
}, {
  tableName: 'users',
  timestamps: true,
  underscored: true
});

module.exports = User;
