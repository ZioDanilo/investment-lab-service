const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const ETF = sequelize.define('ETF', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  ticker: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  description: {
    type: DataTypes.TEXT
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
  tableName: 'etfs'
});

module.exports = ETF;

