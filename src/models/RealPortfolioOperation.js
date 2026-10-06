const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const RealPortfolioOperation = sequelize.define('RealPortfolioOperation', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
  userId: { type: DataTypes.UUID, allowNull: false, field: 'user_id' },
  realPortfolioId: { type: DataTypes.UUID, allowNull: false, field: 'real_portfolio_id' },
  operationType: { type: DataTypes.ENUM('buy', 'sell', 'tax'), allowNull: false, field: 'operation_type' },
  etfId: { type: DataTypes.UUID, allowNull: true, field: 'etf_id' },
  operationDate: { type: DataTypes.DATEONLY, allowNull: false, field: 'operation_date' },
  quantity: { type: DataTypes.DECIMAL(24, 8), allowNull: false },
  unitPrice: { type: DataTypes.DECIMAL(24, 8), allowNull: false, field: 'unit_price' }
}, {
  tableName: 'real_portfolio_operations',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['user_id', 'real_portfolio_id'] },
    { fields: ['real_portfolio_id', 'operation_date'] },
    { fields: ['etf_id'] }
  ]
});

module.exports = RealPortfolioOperation;
