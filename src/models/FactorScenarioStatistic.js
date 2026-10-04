const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const FactorScenarioStatistic = sequelize.define('FactorScenarioStatistic', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  factorId: { type: DataTypes.UUID, allowNull: false },
  macroScenario: { type: DataTypes.ENUM('general','expansion','soft_landing','recession','stagflation'), allowNull: false },
  expectedReturn: { type: DataTypes.DECIMAL(12,8), allowNull: false },
  volatility: { type: DataTypes.DECIMAL(12,8), allowNull: false },
  historicalWeight: { type: DataTypes.DECIMAL(6,5), allowNull: true },
  structuralWeight: { type: DataTypes.DECIMAL(6,5), allowNull: true },
  confidence: { type: DataTypes.DECIMAL(6,5), allowNull: true },
  provenance: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  methodology: { type: DataTypes.TEXT, allowNull: true },
  observedAt: { type: DataTypes.DATE, allowNull: true }
}, {
  tableName: 'factor_scenario_statistics',
  timestamps: true,
  indexes: [{ unique: true, fields: ['factorId','macroScenario'], name: 'factor_scenario_unique' }]
});

module.exports = FactorScenarioStatistic;
