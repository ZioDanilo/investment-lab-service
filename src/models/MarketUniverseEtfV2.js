const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const MarketUniverseEtfV2 = sequelize.define('MarketUniverseEtfV2', {
  runId: { type: DataTypes.UUID, allowNull: false, field: 'run_id' },
  etfId: { type: DataTypes.UUID, allowNull: false, field: 'etf_id' },
  isin: { type: DataTypes.STRING(32), allowNull: false },
  returnsBinary: { type: DataTypes.BLOB, allowNull: false, field: 'returns_binary' },
  valueCount: { type: DataTypes.INTEGER, allowNull: false, field: 'value_count' }
}, {
  timestamps: true,
  tableName: 'market_universe_etf_v2',
  indexes: [
    { unique: true, fields: ['run_id','etf_id'], name: 'unique_market_universe_etf_v2_run_etf' },
    { unique: true, fields: ['run_id','isin'], name: 'unique_market_universe_etf_v2_run_isin' },
    { fields: ['run_id','isin'], name: 'idx_market_universe_etf_v2_run_isin' }
  ]
});

module.exports = MarketUniverseEtfV2;
