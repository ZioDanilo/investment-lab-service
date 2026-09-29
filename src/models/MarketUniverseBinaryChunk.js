const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const MarketUniverseBinaryChunk = sequelize.define('MarketUniverseBinaryChunk', {
  runId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'run_id'
  },
  chunkIndex: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'chunk_index'
  },
  pathStart: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'path_start'
  },
  pathCount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'path_count'
  },
  returnsBinary: {
    type: DataTypes.BLOB,
    allowNull: false,
    field: 'returns_binary'
  },
  intensitiesBinary: {
    type: DataTypes.BLOB,
    allowNull: false,
    field: 'intensities_binary'
  },
  scenariosBinary: {
    type: DataTypes.BLOB,
    allowNull: false,
    field: 'scenarios_binary'
  }
}, {
  timestamps: true,
  tableName: 'market_universe_binary_chunk',
  indexes: [
    {
      unique: true,
      fields: ['run_id', 'chunk_index'],
      name: 'unique_market_universe_binary_run_chunk'
    },
    {
      fields: ['run_id', 'path_start'],
      name: 'idx_market_universe_binary_run_path'
    }
  ]
});

module.exports = MarketUniverseBinaryChunk;
