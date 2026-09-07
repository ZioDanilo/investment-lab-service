const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const MonteCarloGlobalProperty = sequelize.define('MonteCarloGlobalProperty', {
  propertyKey: {
    type: DataTypes.STRING(100),
    allowNull: false,
    primaryKey: true
  },
  value: {
    type: DataTypes.DECIMAL(10, 9),
    allowNull: false
  }
}, {
  timestamps: true,
  tableName: 'monte_carlo_global_properties'
});

module.exports = MonteCarloGlobalProperty;