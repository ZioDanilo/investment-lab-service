const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
module.exports = sequelize.define('Giocatore', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  atleta: { type: DataTypes.STRING(100), allowNull: false, unique: true },
  numero: { type: DataTypes.INTEGER, allowNull: true, unique: true, validate: { min: 1, max: 99 } },
  taglia: { type: DataTypes.STRING(5), allowNull: true },
  ruolo: { type: DataTypes.STRING(100), allowNull: true }
}, { tableName: 'giocatori', underscored: true, timestamps: true });
