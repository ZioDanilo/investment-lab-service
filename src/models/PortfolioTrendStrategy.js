const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

module.exports = sequelize.define('PortfolioTrendStrategy', {
  portfolioId: { type: DataTypes.UUID, primaryKey: true, allowNull: false, field: 'portfolio_id' },
  userId: { type: DataTypes.UUID, allowNull: false, field: 'user_id' },
  strategyKey: { type: DataTypes.STRING(80), allowNull: false, field: 'strategy_key' },
  settings: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} }
}, {
  tableName: 'portfolio_trend_strategies',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  underscored: true
});
