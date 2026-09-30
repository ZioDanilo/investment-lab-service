const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const RealPortfolio = sequelize.define('RealPortfolio', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
  name: { type: DataTypes.STRING(255), allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'EUR' },
  status: { type: DataTypes.ENUM('active', 'archived'), allowNull: false, defaultValue: 'active' }
}, {
  tableName: 'real_portfolios',
  timestamps: true,
  underscored: true
});

module.exports = RealPortfolio;
