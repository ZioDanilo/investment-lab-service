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
  nickname: {
    type: DataTypes.STRING,
    allowNull: true
  },
  ticker: {
    type: DataTypes.STRING
  },
  eodhdCode: {
    type: DataTypes.STRING,
    allowNull: true,
    field: 'eodhd_code'
  },
  eodhdExchange: {
    type: DataTypes.STRING,
    allowNull: true,
    field: 'eodhd_exchange'
  },
  eodhdCurrency: {
    type: DataTypes.STRING(8),
    allowNull: true,
    field: 'eodhd_currency'
  },
  indexId: {
    type: DataTypes.UUID,
    allowNull: true,
    comment: 'Underlying index reference used by Factor Engine V2'
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
  },
  longTermExpectedReturn: {
    type: DataTypes.DECIMAL(7, 4),
    allowNull: true,
    comment: 'Long-term expected CAGR target (e.g., 0.08 = 8%). Used for Monte Carlo calibration.'
  },
  calibratedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'Timestamp of last calibration run. Null = not yet calibrated.'
  },
  lastCalibrationMedianCagr: {
    type: DataTypes.DECIMAL(7, 4),
    allowNull: true,
    comment: 'Median CAGR from the most recent calibration (diagnostic only).'
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


