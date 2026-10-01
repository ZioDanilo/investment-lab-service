const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const EtfModelFit = sequelize.define('EtfModelFit', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  etfId: { type: DataTypes.UUID, allowNull: false },
  status: { type: DataTypes.ENUM('pending','ready','review_required','unsupported'), allowNull: false, defaultValue: 'pending' },
  historicalObservations: { type: DataTypes.INTEGER, allowNull: true },
  rSquared: { type: DataTypes.DECIMAL(8,7), allowNull: true },
  realVolatility: { type: DataTypes.DECIMAL(12,8), allowNull: true },
  modelVolatility: { type: DataTypes.DECIMAL(12,8), allowNull: true },
  realCagr: { type: DataTypes.DECIMAL(12,8), allowNull: true },
  modelCagr: { type: DataTypes.DECIMAL(12,8), allowNull: true },
  realMaxDrawdown: { type: DataTypes.DECIMAL(12,8), allowNull: true },
  modelMaxDrawdown: { type: DataTypes.DECIMAL(12,8), allowNull: true },
  residualVolatility: { type: DataTypes.DECIMAL(12,8), allowNull: true },
  returnCorrelation: { type: DataTypes.DECIMAL(9,8), allowNull: true },
  stressDiagnostics: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  confidence: { type: DataTypes.DECIMAL(6,5), allowNull: true },
  notes: { type: DataTypes.TEXT, allowNull: true },
  validatedAt: { type: DataTypes.DATE, allowNull: true }
}, {
  tableName: 'etf_model_fits',
  timestamps: true,
  indexes: [{ fields: ['etfId','createdAt'] }, { fields: ['status'] }]
});

module.exports = EtfModelFit;
