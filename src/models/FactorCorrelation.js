const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const FactorCorrelation = sequelize.define('FactorCorrelation', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  factor1Id: { type: DataTypes.UUID, allowNull: false },
  factor2Id: { type: DataTypes.UUID, allowNull: false },
  macroScenario: { type: DataTypes.ENUM('general','expansion','soft_landing','recession','stagflation'), allowNull: false },
  correlation: { type: DataTypes.DECIMAL(9,8), allowNull: false, validate: { min: -1, max: 1 } },
  historicalWeight: { type: DataTypes.DECIMAL(6,5), allowNull: true },
  structuralWeight: { type: DataTypes.DECIMAL(6,5), allowNull: true },
  confidence: { type: DataTypes.DECIMAL(6,5), allowNull: true },
  provenance: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  observedAt: { type: DataTypes.DATE, allowNull: true }
}, {
  tableName: 'factor_correlations',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['factor1Id','factor2Id','macroScenario'], name: 'factor_corr_unique' },
    { fields: ['macroScenario'] }
  ],
  validate: {
    differentFactors() {
      if (this.factor1Id === this.factor2Id) throw new Error('factor1Id and factor2Id must differ');
    }
  }
});

module.exports = FactorCorrelation;
