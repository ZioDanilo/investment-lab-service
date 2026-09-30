const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const RealPortfolio = sequelize.define('RealPortfolio', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
  userId: { type: DataTypes.UUID, allowNull: true, field: 'user_id' },
  name: { type: DataTypes.STRING(255), allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  status: { type: DataTypes.ENUM('open', 'archived'), allowNull: false, defaultValue: 'open' }
}, {
  tableName: 'real_portfolios',
  timestamps: true,
  underscored: true
});

module.exports = RealPortfolio;
