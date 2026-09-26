const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const MarketUniverseMonth = sequelize.define('MarketUniverseMonth', {
  runId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'run_id'
  },
  pathId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'path_id'
  },
  monthIndex: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'month_index'
  },
  scenario: {
    type: DataTypes.STRING,
    allowNull: false,
    field: 'scenario'
  },
  intensity: {
    type: DataTypes.DOUBLE,
    allowNull: false,
    field: 'intensity'
  },
  returnsVector: {
    type: DataTypes.ARRAY(DataTypes.DOUBLE),
    allowNull: false,
    field: 'returns_vector'
  }
}, {
  timestamps: true,
  tableName: 'market_universe_month',
  indexes: [
    {
      unique: true,
      fields: ['run_id', 'path_id', 'month_index'],
      name: 'unique_market_universe_run_path_month'
    },
    {
      fields: ['run_id', 'path_id', 'month_index'],
      name: 'idx_market_universe_run_path_month'
    },
    {
      fields: ['run_id', 'month_index'],
      name: 'idx_market_universe_run_month_index'
    }
  ]
});

module.exports = MarketUniverseMonth;
