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
    unique: true,
    comment: 'International Securities Identification Number'
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  ticker: {
    type: DataTypes.STRING,
    unique: true
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
  tableName: 'anagrafica_etf'
});

module.exports = ETF;

