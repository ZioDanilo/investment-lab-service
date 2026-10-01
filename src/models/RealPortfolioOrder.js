const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const RealPortfolioOrder = sequelize.define('RealPortfolioOrder', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
  userId: { type: DataTypes.UUID, allowNull: false, field: 'user_id', references: { model: 'users', key: 'id' } },
  realPortfolioId: { type: DataTypes.UUID, allowNull: false, field: 'real_portfolio_id', references: { model: 'portafogli', key: 'id' } },
  position: { type: DataTypes.INTEGER, allowNull: false }
}, {
  tableName: 'real_portfolio_order',
  timestamps: false,
  indexes: [
    { unique: true, fields: ['user_id', 'real_portfolio_id'], name: 'unique_real_portfolio_order' },
    { unique: true, fields: ['user_id', 'position'], name: 'unique_real_portfolio_position' }
  ]
});

module.exports = RealPortfolioOrder;
