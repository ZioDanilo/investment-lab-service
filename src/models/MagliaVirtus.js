const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const MagliaVirtus = sequelize.define('MagliaVirtus', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  atleta: { type: DataTypes.STRING(100), allowNull: false },
  numero: { type: DataTypes.INTEGER, allowNull: false, validate: { min: 1, max: 99 } },
  taglia: { type: DataTypes.STRING(5), allowNull: false }
}, { tableName: 'maglie_virtus', underscored: true, timestamps: true });

module.exports = MagliaVirtus;
