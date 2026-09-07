const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const EtfCorrelation = sequelize.define('EtfCorrelation', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  isin1: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'Base ETF ISIN'
  },
  isin2: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'Target ETF ISIN'
  },
  expansion: {
    type: DataTypes.DECIMAL(5, 4),
    allowNull: false
  },
  recession: {
    type: DataTypes.DECIMAL(5, 4),
    allowNull: false
  },
  stagflation: {
    type: DataTypes.DECIMAL(5, 4),
    allowNull: false
  },
  soft_landing: {
    type: DataTypes.DECIMAL(5, 4),
    allowNull: false
  }
}, {
  timestamps: true,
  tableName: 'etf_correlations',
  indexes: [
    {
      unique: true,
      fields: ['isin1', 'isin2'],
      name: 'unique_isin_pair_idx'
    }
  ]
});

module.exports = EtfCorrelation;
