const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const EtfSpecificRisk = sequelize.define('EtfSpecificRisk', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  etfId: { type: DataTypes.UUID, allowNull: false, unique: true },
  annualizedVolatility: { type: DataTypes.DECIMAL(12,8), allowNull: false },
  residualVolatility: { type: DataTypes.DECIMAL(12,8), allowNull: true },
  trackingError: { type: DataTypes.DECIMAL(12,8), allowNull: true },
  trackingDifference: { type: DataTypes.DECIMAL(12,8), allowNull: true },
  alpha: { type: DataTypes.DECIMAL(12,8), allowNull: false, defaultValue: 0 },
  confidence: { type: DataTypes.DECIMAL(6,5), allowNull: true },
  provenance: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  fallbackUsed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  calibratedAt: { type: DataTypes.DATE, allowNull: true }
}, { tableName: 'etf_specific_risks', timestamps: true });

module.exports = EtfSpecificRisk;
