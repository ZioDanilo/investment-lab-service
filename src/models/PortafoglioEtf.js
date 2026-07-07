const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const PortafoglioEtf = sequelize.define('PortafoglioEtf', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  portafoglioId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'portafogli',
      key: 'id'
    }
  },
  etfId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'anagrafica_etf',
      key: 'id'
    }
  },
  peso: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
    validate: {
      min: 0,
      max: 100
    }
  }
}, {
  tableName: 'portafoglio_etf',
  timestamps: false,
  indexes: [
    {
      fields: ['portafoglioId', 'etfId'],
      unique: true,
      name: 'unique_portafoglio_etf'
    }
  ]
});

module.exports = PortafoglioEtf;
