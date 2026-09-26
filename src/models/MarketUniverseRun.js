const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const MarketUniverseRun = sequelize.define('MarketUniverseRun', {
  runId: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
    allowNull: false,
    field: 'run_id'
  },
  generatedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    field: 'generated_at'
  },
  seed: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'seed'
  },
  pathCount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'path_count'
  },
  monthCount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'month_count'
  },
  assetCount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'asset_count'
  },
  assetOrder: {
    type: DataTypes.ARRAY(DataTypes.STRING),
    allowNull: false,
    field: 'asset_order'
  },
  status: {
    type: DataTypes.ENUM('GENERATING', 'READY', 'ACTIVE', 'FAILED', 'FAILED_CLEANUP'),
    allowNull: false,
    defaultValue: 'GENERATING',
    field: 'status'
  },
  active: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: 'active'
  }
}, {
  timestamps: true,
  tableName: 'market_universe_run',
  indexes: [
    {
      unique: true,
      fields: ['seed', 'generated_at'],
      name: 'unique_market_universe_run_seed_generated_at'
    },
    {
      unique: true,
      fields: ['active'],
      where: { active: true },
      name: 'unique_market_universe_run_active_true'
    },
    {
      fields: ['active', 'status'],
      name: 'idx_market_universe_run_active_status'
    }
  ]
});

module.exports = MarketUniverseRun;
