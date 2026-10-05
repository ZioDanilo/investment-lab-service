const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const MarketUniverseRunV2 = sequelize.define('MarketUniverseRunV2', {
  runId: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false, field: 'run_id' },
  generatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'generated_at' },
  seed: { type: DataTypes.INTEGER, allowNull: false },
  pathCount: { type: DataTypes.INTEGER, allowNull: false, field: 'path_count' },
  monthCount: { type: DataTypes.INTEGER, allowNull: false, field: 'month_count' },
  assetCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'asset_count' },
  assetOrder: { type: DataTypes.ARRAY(DataTypes.STRING), allowNull: false, defaultValue: [], field: 'asset_order' },
  scenarioBinary: { type: DataTypes.BLOB, allowNull: true, field: 'scenario_binary' },
  intensityBinary: { type: DataTypes.BLOB, allowNull: true, field: 'intensity_binary' },
  generationProgress: { type: DataTypes.DOUBLE, allowNull: false, defaultValue: 0, field: 'generation_progress' },
  status: { type: DataTypes.ENUM('GENERATING','READY','ACTIVE','FAILED'), allowNull: false, defaultValue: 'GENERATING' },
  active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }
}, {
  timestamps: true,
  tableName: 'market_universe_run_v2',
  indexes: [
    { unique: true, fields: ['active'], where: { active: true }, name: 'unique_market_universe_run_v2_active_true' },
    { fields: ['active','status'], name: 'idx_market_universe_run_v2_active_status' }
  ]
});

module.exports = MarketUniverseRunV2;
