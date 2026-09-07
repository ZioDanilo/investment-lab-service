const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const ScenarioIntensityConfiguration = sequelize.define('ScenarioIntensityConfiguration', {
  scenario: {
    type: DataTypes.ENUM('expansion', 'recession', 'stagflation', 'soft_landing'),
    allowNull: false,
    primaryKey: true
  },
  meanIntensity: {
    type: DataTypes.DECIMAL(10, 9),
    allowNull: false
  },
  stdDevIntensity: {
    type: DataTypes.DECIMAL(10, 9),
    allowNull: false
  }
}, {
  timestamps: true,
  tableName: 'scenario_intensity_configurations'
});

module.exports = ScenarioIntensityConfiguration;