const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const InvestmentIndex = sequelize.define('InvestmentIndex', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING(200), allowNull: false },
  provider: { type: DataTypes.STRING(120), allowNull: true },
  code: { type: DataTypes.STRING(120), allowNull: true },
  methodologyUrl: { type: DataTypes.TEXT, allowNull: true },
  methodology: { type: DataTypes.TEXT, allowNull: true },
  holdings: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  geography: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  sectors: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  styles: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  currencies: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  concentration: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  provenance: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  confidence: { type: DataTypes.DECIMAL(6,5), allowNull: true },
  observedAt: { type: DataTypes.DATE, allowNull: true }
}, {
  tableName: 'investment_indices',
  timestamps: true,
  indexes: [{ fields: ['provider','code'] }, { fields: ['name'] }]
});

module.exports = InvestmentIndex;
