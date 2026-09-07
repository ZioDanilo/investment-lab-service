const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const TransitionMatrix = sequelize.define('TransitionMatrix', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  fromScenario: {
    type: DataTypes.ENUM('expansion', 'recession', 'stagflation', 'soft_landing'),
    allowNull: false
  },
  toScenario: {
    type: DataTypes.ENUM('expansion', 'recession', 'stagflation', 'soft_landing'),
    allowNull: false
  },
  probability: {
    type: DataTypes.DECIMAL(10, 6),
    allowNull: false,
    validate: {
      min: 0,
      max: 1
    },
    comment: 'Conditional transition probability P(to|from)'
  },
  description: {
    type: DataTypes.STRING(255),
    allowNull: true
  }
}, {
  timestamps: true,
  tableName: 'transition_matrix',
  indexes: [
    {
      unique: true,
      fields: ['fromScenario', 'toScenario'],
      name: 'unique_transition_idx'
    }
  ]
});

module.exports = TransitionMatrix;
