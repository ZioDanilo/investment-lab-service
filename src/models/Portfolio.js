const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Portfolio = sequelize.define('Portfolio', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  description: {
    type: DataTypes.TEXT
  },
  holdings: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: [],
    comment: 'Array of {etfId, weight}'
  },
  kpis: {
    type: DataTypes.JSONB,
    defaultValue: {
      expectedReturn: null,
      volatility: null,
      maxDrawdown: null,
      recoveryMonths: null,
      robustness: null
    }
  },
  status: {
    type: DataTypes.ENUM('active', 'archived'),
    defaultValue: 'active'
  }
}, {
  timestamps: true,
  tableName: 'portfolios'
});

module.exports = Portfolio;

