const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const StructuralProbability = sequelize.define('StructuralProbability', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  scenario: {
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
    comment: 'Initial probability for year 1 (0-1)'
  },
  description: {
    type: DataTypes.STRING(255),
    allowNull: true
  }
}, {
  timestamps: true,
  tableName: 'structural_probabilities',
  indexes: [
    {
      unique: true,
      fields: ['scenario'],
      name: 'unique_scenario_idx'
    }
  ]
});

module.exports = StructuralProbability;
