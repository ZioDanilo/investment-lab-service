const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const RealPortfolioOperation = sequelize.define('RealPortfolioOperation', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
  realPortfolioId: { type: DataTypes.UUID, allowNull: false, field: 'real_portfolio_id' },
  operationType: { type: DataTypes.ENUM('buy', 'sell'), allowNull: false, field: 'operation_type' },
  product: { type: DataTypes.STRING(255), allowNull: false },
  quantity: { type: DataTypes.DECIMAL(24, 8), allowNull: false },
  unitPrice: { type: DataTypes.DECIMAL(24, 8), allowNull: false, field: 'unit_price' },
  operationDate: { type: DataTypes.DATEONLY, allowNull: false, field: 'operation_date' }
}, { tableName: 'real_portfolio_operations', timestamps: true, underscored: true });

module.exports = RealPortfolioOperation;
