const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const EtfMacroStatistics = sequelize.define('EtfMacroStatistics', {
  isin: {
    type: DataTypes.STRING,
    allowNull: false,
    primaryKey: true,
    comment: 'ETF ISIN'
  },
  macroScenario: {
    type: DataTypes.ENUM('expansion', 'soft_landing', 'recession', 'stagflation', 'general'),
    allowNull: false,
    primaryKey: true,
    comment: 'Macro economic scenario'
  },
  expectedReturn: {
    type: DataTypes.DECIMAL(7, 4),
    allowNull: false,
    comment: 'Expected annual return (in percentages, e.g., 8.5 for 8.5%)'
  },
  volatility: {
    type: DataTypes.DECIMAL(7, 4),
    allowNull: false,
    comment: 'Annual volatility (in percentages, e.g., 12.3 for 12.3%)'
  },
  maxDrawdown: {
    type: DataTypes.DECIMAL(7, 4),
    allowNull: true,
    comment: 'Deprecated Monte Carlo input; optional diagnostic maximum drawdown (in percentage points)'
  },
  returnRangeMin: {
    type: DataTypes.DECIMAL(7, 4),
    allowNull: false,
    comment: 'Minimum annual return (in percentages)'
  },
  returnRangeMax: {
    type: DataTypes.DECIMAL(7, 4),
    allowNull: false,
    comment: 'Maximum annual return (in percentages)'
  }
}, {
  timestamps: true,
  tableName: 'etf_macro_statistics',
  indexes: [
    {
      unique: true,
      fields: ['isin', 'macroScenario'],
      name: 'unique_macro_stats_isin_scenario_idx'
    },
    {
      fields: ['isin'],
      name: 'idx_macro_stats_isin'
    }
  ]
});

module.exports = EtfMacroStatistics;