const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const ScenarioInertiaConfiguration = sequelize.define('ScenarioInertiaConfiguration', {
  scenario: {
    type: DataTypes.ENUM('expansion', 'recession', 'stagflation', 'soft_landing'),
    allowNull: false,
    primaryKey: true
  },
  entryProbability: {
    type: DataTypes.DECIMAL(10, 9),
    allowNull: false
  },
  persistenceProbability: {
    type: DataTypes.DECIMAL(10, 9),
    allowNull: false
  },
  entryMonths: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  exitStartMonth: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  exitDecay: {
    type: DataTypes.DECIMAL(10, 9),
    allowNull: false
  }
}, {
  timestamps: true,
  tableName: 'scenario_inertia_configurations'
});

module.exports = ScenarioInertiaConfiguration;