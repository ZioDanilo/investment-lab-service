const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Portafoglio = sequelize.define('Portafoglio', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
    allowNull: false
  },
  nome: {
    type: DataTypes.STRING(255),
    allowNull: false,
    defaultValue: 'Senza nome'
  },
  descrizione: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  dataCreazione: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  dataModifica: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'portafogli',
  timestamps: false
});

module.exports = Portafoglio;
