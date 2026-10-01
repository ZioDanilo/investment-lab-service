const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const EtfFactorExposure = sequelize.define('EtfFactorExposure', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  etfId: { type: DataTypes.UUID, allowNull: false },
  factorId: { type: DataTypes.UUID, allowNull: false },
  beta: { type: DataTypes.DECIMAL(14,8), allowNull: false },
  historicalBeta: { type: DataTypes.DECIMAL(14,8), allowNull: true },
  structuralBeta: { type: DataTypes.DECIMAL(14,8), allowNull: true },
  historicalWeight: { type: DataTypes.DECIMAL(6,5), allowNull: false },
  structuralWeight: { type: DataTypes.DECIMAL(6,5), allowNull: false },
  usableHistoryYears: { type: DataTypes.DECIMAL(7,3), allowNull: true },
  confidence: { type: DataTypes.DECIMAL(6,5), allowNull: true },
  provenance: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  calibratedAt: { type: DataTypes.DATE, allowNull: true }
}, {
  tableName: 'etf_factor_exposures',
  timestamps: true,
  indexes: [{ unique: true, fields: ['etfId','factorId'], name: 'etf_factor_unique' }, { fields: ['factorId'] }]
});

module.exports = EtfFactorExposure;
