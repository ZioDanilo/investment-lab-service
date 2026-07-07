const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const ETF = sequelize.define('ETF', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  isin: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: {
      name: 'unique_isin',
      msg: 'ISIN deve essere unico'
    },
    comment: 'International Securities Identification Number'
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  ticker: {
    type: DataTypes.STRING
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  assetClass: {
    type: DataTypes.STRING
  },
  expense: {
    type: DataTypes.DECIMAL(10, 4)
  },
  historicalData: {
    type: DataTypes.JSONB,
    defaultValue: []
  },
  metrics: {
    type: DataTypes.JSONB,
    defaultValue: {
      yield: null,
      volatility: null,
      beta: null
    }
  }
}, {
  timestamps: true,
  tableName: 'anagrafica_etf',
  indexes: [
    {
      unique: true,
      fields: ['isin'],
      name: 'unique_isin_idx'
    }
  ]
});

module.exports = ETF;


